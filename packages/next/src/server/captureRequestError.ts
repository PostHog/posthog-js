import { isArray, isFunction, isNull, isUndefined } from '@posthog/core'
import type { ErrorTracking } from '@posthog/core'
import { cookieStoreFromHeader, isOptedOut, readPostHogCookie } from '../shared/cookie.js'
import type { PostHogCookieState } from '../shared/cookie.js'
import { resolveApiKey, resolveHostOrDefault } from '../shared/config.js'
import { buildContextData, POSTHOG_DISTINCT_ID_HEADER, POSTHOG_SESSION_ID_HEADER } from '../shared/tracing-headers.js'
import type { NextRequestErrorContext, NextRequestErrorRequest, OnRequestErrorOptions } from './onRequestError.types.js'

interface PostHogExceptionCaptureClient {
    captureExceptionImmediate(
        error: unknown,
        distinctId?: string,
        additionalProperties?: Record<string, unknown>
    ): Promise<void>
}

type ServerOptions = NonNullable<OnRequestErrorOptions['serverOptions']>

type GetOrCreateClient = (apiKey: string, options?: ServerOptions) => Promise<PostHogExceptionCaptureClient>

type HeaderValue = string | string[] | null | undefined

type HeadersLike = NextRequestErrorRequest['headers']

// Match the browser SDK: a session ends after 30 minutes without activity or 24 hours after it started.
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const SESSION_MAX_LENGTH_MS = 24 * 60 * 60 * 1000

const TRACING_HEADER_MAX_LENGTH = 1000
// Remove C0 controls, DEL, and C1 controls from PostHog tracing IDs only.
// oxlint-disable-next-line no-control-regex
const TRACING_HEADER_CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f-\x9f]/g

// The marker posthog-node checks before it captures an exception, so a marked error is captured only once.
const PREVIOUSLY_CAPTURED_ERROR_KEY = '__posthog_previously_captured_error'

export async function captureNextRequestError(
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    options: OnRequestErrorOptions,
    getOrCreateClient: GetOrCreateClient
): Promise<void> {
    if (options.disabled || isPreviouslyCapturedError(error)) {
        return
    }

    const apiKey = resolveApiKey(options.apiKey)
    if (!apiKey) {
        return
    }

    const cookieHeader = getHeader(request.headers, 'cookie')
    const cookieStore = cookieStoreFromHeader(cookieHeader ?? '')
    if (isOptedOut(cookieStore, apiKey, options.consent)) {
        return
    }

    const identity = resolveRequestIdentity(request.headers, readPostHogCookie(cookieStore, apiKey), Date.now())
    const distinctId = identity.distinctId
    const shouldStripUrlHash = options.serverOptions?.disable_capture_url_hashes === true
    let properties = buildExceptionProperties(error, request, context, identity.properties, shouldStripUrlHash)

    let beforeCaptureResult: Awaited<ReturnType<NonNullable<OnRequestErrorOptions['beforeCapture']>>> | undefined
    try {
        beforeCaptureResult = await options.beforeCapture?.({ error, request, context, distinctId, properties })
    } catch (captureError) {
        // oxlint-disable-next-line no-console
        console.warn('[PostHog Next.js] Failed to run beforeCapture for server-side exception:', captureError)
        return
    }
    if (beforeCaptureResult === false) {
        return
    }
    if (beforeCaptureResult && typeof beforeCaptureResult === 'object') {
        properties = { ...properties, ...beforeCaptureResult }
    }

    try {
        const host = resolveHostOrDefault(options.host ?? options.serverOptions?.host)
        const client = await getOrCreateClient(apiKey, {
            ...options.serverOptions,
            host,
        })

        await client.captureExceptionImmediate(error, distinctId, properties)
    } catch (captureError) {
        // oxlint-disable-next-line no-console
        console.warn('[PostHog Next.js] Failed to capture server-side exception:', captureError)
    }
}

/**
 * Marks an error that `@posthog/next` captured outside `onRequestError`, so a later
 * `onRequestError` call or posthog-node capture for the same error is skipped.
 */
export function markErrorAsCaptured(error: unknown): void {
    if (!isObjectLike(error)) {
        return
    }
    try {
        Object.defineProperty(error, PREVIOUSLY_CAPTURED_ERROR_KEY, {
            value: true,
            configurable: true,
            enumerable: false,
            writable: true,
        })
    } catch {
        // A frozen or non-extensible error cannot be marked.
    }
}

function isPreviouslyCapturedError(error: unknown): boolean {
    return (
        isObjectLike(error) && (error as ErrorTracking.PreviouslyCapturedError)[PREVIOUSLY_CAPTURED_ERROR_KEY] === true
    )
}

function isObjectLike(value: unknown): value is object {
    return (typeof value === 'object' && !isNull(value)) || isFunction(value)
}

/**
 * Tracing headers from the browser SDK win over the PostHog cookie. They are analytics
 * context only and are never used for authentication.
 */
function resolveRequestIdentity(
    headers: HeadersLike,
    cookieState: PostHogCookieState | null,
    now: number
): ReturnType<typeof buildContextData> {
    const tracing = {
        distinctId: getTracingHeader(headers, POSTHOG_DISTINCT_ID_HEADER),
        sessionId: getTracingHeader(headers, POSTHOG_SESSION_ID_HEADER),
    }
    const activeCookieState = cookieState ? { ...cookieState, sessionId: getActiveSessionId(cookieState, now) } : null
    return buildContextData(tracing, activeCookieState)
}

function getActiveSessionId(state: PostHogCookieState, now: number): string | undefined {
    const { sessionId, sessionLastActivityTimestamp, sessionStartTimestamp } = state
    if (!sessionId || isUndefined(sessionLastActivityTimestamp) || isUndefined(sessionStartTimestamp)) {
        return undefined
    }
    if (
        now - sessionLastActivityTimestamp > SESSION_IDLE_TIMEOUT_MS ||
        now - sessionStartTimestamp > SESSION_MAX_LENGTH_MS
    ) {
        return undefined
    }
    return sessionId
}

function getTracingHeader(headers: HeadersLike, name: string): string | undefined {
    const value = getRawHeader(headers, name)
    for (const item of isArray(value) ? value : [value]) {
        if (typeof item !== 'string') {
            continue
        }
        const sanitized = item.replace(TRACING_HEADER_CONTROL_CHARS_REGEX, '').trim()
        if (sanitized) {
            return sanitized.slice(0, TRACING_HEADER_MAX_LENGTH)
        }
    }
    return undefined
}

function buildExceptionProperties(
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    identityProperties?: Record<string, string>,
    shouldStripUrlHash: boolean = false
): Record<string, unknown> {
    const properties: Record<string, unknown> = {
        ...identityProperties,
    }

    const method = normalizeString(request.method)
    if (method) {
        properties.$http_method = method
        properties.$request_method = method
    }

    const path = normalizeRequestPath(request, shouldStripUrlHash)
    if (path) {
        properties.$pathname = path
        properties.$request_path = path
        addStringProperty(properties, '$current_url', buildCurrentUrl(request, path))
    }

    addStringProperty(properties, '$user_agent', getFirstHeader(request.headers, 'user-agent'))

    const digest = getErrorDigest(error)
    if (digest) {
        properties.nextjs_error_digest = digest
    }

    addStringProperty(properties, 'nextjs_router_kind', context.routerKind)
    addStringProperty(properties, 'nextjs_route_path', context.routePath)
    addStringProperty(properties, 'nextjs_route_type', context.routeType)
    addStringProperty(properties, 'nextjs_render_source', context.renderSource)
    addStringProperty(properties, 'nextjs_revalidate_reason', context.revalidateReason)

    return properties
}

function normalizeRequestPath(request: NextRequestErrorRequest, shouldStripUrlHash: boolean): string | undefined {
    const explicitPath = normalizeString(request.path)
    if (explicitPath) {
        return normalizePathValue(explicitPath, shouldStripUrlHash)
    }

    const url = normalizeString(request.url)
    if (!url) {
        return undefined
    }

    try {
        // oxlint-disable-next-line compat/compat
        const parsed = new URL(url, 'http://localhost')
        return shouldStripUrlHash ? parsed.pathname : `${parsed.pathname}${parsed.hash}`
    } catch {
        return normalizePathValue(url, shouldStripUrlHash)
    }
}

// The path has no query string, so neither does the URL.
function buildCurrentUrl(request: NextRequestErrorRequest, path: string): string | undefined {
    if (!path.startsWith('/')) {
        return undefined
    }

    const absoluteUrl = parseAbsoluteUrl(request.url)
    const host = getFirstHeader(request.headers, 'host') ?? absoluteUrl?.host
    if (!host) {
        return undefined
    }

    const forwardedProtocol = getFirstHeader(request.headers, 'x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
    const protocol = [forwardedProtocol, absoluteUrl?.protocol.slice(0, -1)].find(isHttpProtocol) ?? 'https'
    try {
        // oxlint-disable-next-line compat/compat
        const { origin } = new URL(`${protocol}://${host}`)
        return origin === 'null' ? undefined : `${origin}${path}`
    } catch {
        return undefined
    }
}

function parseAbsoluteUrl(value: unknown): URL | undefined {
    const url = normalizeString(value)
    if (!url) {
        return undefined
    }
    try {
        // oxlint-disable-next-line compat/compat
        return new URL(url)
    } catch {
        return undefined
    }
}

function isHttpProtocol(value: string | undefined): value is 'http' | 'https' {
    return value === 'http' || value === 'https'
}

function normalizePathValue(value: string, shouldStripUrlHash: boolean): string {
    const valueWithoutSearch = stripSearch(value)
    return shouldStripUrlHash ? stripHash(valueWithoutSearch) : valueWithoutSearch
}

function stripSearch(value: string): string {
    const searchIndex = value.indexOf('?')
    const hashIndex = value.indexOf('#')
    if (searchIndex === -1 || (hashIndex !== -1 && hashIndex < searchIndex)) {
        return value
    }
    return `${value.slice(0, searchIndex)}${hashIndex === -1 ? '' : value.slice(hashIndex)}`
}

function stripHash(value: string): string {
    return value.split('#', 1)[0]
}

function getHeader(headers: HeadersLike, name: string): string | undefined {
    return normalizeHeaderValue(getRawHeader(headers, name))
}

function getFirstHeader(headers: HeadersLike, name: string): string | undefined {
    const value = getRawHeader(headers, name)
    return normalizeString(isArray(value) ? value[0] : value)
}

function getRawHeader(headers: HeadersLike, name: string): HeaderValue {
    if (!headers || typeof headers !== 'object') {
        return undefined
    }

    const getter = (headers as { get?: unknown }).get
    if (isFunction(getter)) {
        return getter.call(headers, name) ?? getter.call(headers, name.toLowerCase())
    }

    const record = headers as Record<string, HeaderValue>
    return record[name] ?? record[name.toLowerCase()]
}

function normalizeHeaderValue(value: HeaderValue): string | undefined {
    if (isArray(value)) {
        return value.join('; ')
    }
    return normalizeString(value)
}

function normalizeString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function addStringProperty(properties: Record<string, unknown>, key: string, value: unknown): void {
    const normalized = normalizeString(value)
    if (normalized) {
        properties[key] = normalized
    }
}

function getErrorDigest(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
        return undefined
    }
    return normalizeString((error as { digest?: unknown }).digest)
}
