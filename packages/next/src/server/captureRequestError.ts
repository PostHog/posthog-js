import { isArray, isFunction, isNull, isNumber, isUndefined } from '@posthog/core'
import type { ErrorTracking } from '@posthog/core'
import { cookieStoreFromHeader, isOptedOut, readPostHogCookie } from '../shared/cookie.js'
import type { PostHogCookieState } from '../shared/cookie.js'
import { resolveApiKey, resolveHostOrDefault } from '../shared/config.js'
import {
    buildContextData,
    POSTHOG_DISTINCT_ID_HEADER,
    POSTHOG_SESSION_ID_HEADER,
    POSTHOG_WINDOW_ID_HEADER,
} from '../shared/tracing-headers.js'
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

// Match the browser SDK: a session ends after `session_idle_timeout_seconds` without activity (30 minutes unless
// configured, clamped to 1 minute to 10 hours) or 24 hours after it started.
const DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS = 30 * 60
const MIN_SESSION_IDLE_TIMEOUT_SECONDS = 60
const MAX_SESSION_IDLE_TIMEOUT_SECONDS = 10 * 60 * 60
const SESSION_MAX_LENGTH_MS = 24 * 60 * 60 * 1000

const TRACING_HEADER_MAX_LENGTH = 1000
// Remove C0 controls, DEL, and C1 controls from PostHog tracing IDs only.
// oxlint-disable-next-line no-control-regex
const TRACING_HEADER_CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f-\x9f]/g

// The marker posthog-node checks before it captures an exception, so a marked error is captured only once.
const PREVIOUSLY_CAPTURED_ERROR_KEY = '__posthog_previously_captured_error'
// Set while withPostHogProxy captures an error, so an onRequestError call for the same error leaves it to the
// wrapper. It cannot be the marker above: posthog-node would skip the wrapper's own capture.
const PROXY_CAPTURE_KEY = '__posthog_next_proxy_capture'

export async function captureNextRequestError(
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    options: OnRequestErrorOptions,
    getOrCreateClient: GetOrCreateClient
): Promise<void> {
    if (isPreviouslyCapturedError(error) || hasMarker(error, PROXY_CAPTURE_KEY)) {
        return
    }
    await sendNextRequestError(error, request, context, options, getOrCreateClient)
}

/**
 * Captures a request error whether or not it was captured before, and resolves to whether the exception reached
 * posthog-node. It resolves to false when capture is disabled, there is no API key, the user opted out,
 * `beforeCapture` skipped the error or the client could not be created.
 */
export async function sendNextRequestError(
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    options: OnRequestErrorOptions,
    getOrCreateClient: GetOrCreateClient
): Promise<boolean> {
    if (options.disabled) {
        return false
    }

    const apiKey = resolveApiKey(options.apiKey)
    if (!apiKey) {
        return false
    }

    const cookieHeader = getHeader(request.headers, 'cookie')
    const cookieStore = cookieStoreFromHeader(cookieHeader ?? '')
    if (isOptedOut(cookieStore, apiKey, options.consent)) {
        return false
    }

    const identity = resolveRequestIdentity(
        request.headers,
        readPostHogCookie(cookieStore, apiKey),
        Date.now(),
        getSessionIdleTimeoutMs(options.sessionIdleTimeoutSeconds)
    )
    const distinctId = identity.distinctId
    const shouldStripUrlHash = options.serverOptions?.disable_capture_url_hashes === true
    let properties = buildExceptionProperties(error, request, context, identity.properties, shouldStripUrlHash)

    let beforeCaptureResult: Awaited<ReturnType<NonNullable<OnRequestErrorOptions['beforeCapture']>>> | undefined
    try {
        beforeCaptureResult = await options.beforeCapture?.({ error, request, context, distinctId, properties })
    } catch (captureError) {
        // oxlint-disable-next-line no-console
        console.warn('[PostHog Next.js] Failed to run beforeCapture for server-side exception:', captureError)
        return false
    }
    if (beforeCaptureResult === false) {
        return false
    }
    if (beforeCaptureResult && typeof beforeCaptureResult === 'object') {
        properties = { ...properties, ...beforeCaptureResult }
    }

    let client: PostHogExceptionCaptureClient
    try {
        const host = resolveHostOrDefault(options.host ?? options.serverOptions?.host)
        client = await getOrCreateClient(apiKey, {
            ...options.serverOptions,
            host,
        })
    } catch (captureError) {
        // oxlint-disable-next-line no-console
        console.warn('[PostHog Next.js] Failed to capture server-side exception:', captureError)
        return false
    }

    try {
        await client.captureExceptionImmediate(error, distinctId, properties)
    } catch (captureError) {
        // oxlint-disable-next-line no-console
        console.warn('[PostHog Next.js] Failed to capture server-side exception:', captureError)
    }
    // posthog-node already retried a failed send, so the exception counts as handed over either way: a second
    // attempt from onRequestError would go through the same transport and double the wait.
    return true
}

/**
 * Claims an error for withPostHogProxy, so onRequestError skips it while the wrapper captures it. Returns false
 * when the error was already captured or claimed. An error that cannot be marked (a primitive, a frozen object)
 * is still captured.
 */
export function claimProxyError(error: unknown): boolean {
    if (isPreviouslyCapturedError(error) || hasMarker(error, PROXY_CAPTURE_KEY)) {
        return false
    }
    setMarker(error, PROXY_CAPTURE_KEY, true)
    return true
}

/** Ends a withPostHogProxy claim, marking the error as captured when it reached posthog-node. */
export function settleProxyError(error: unknown, captured: boolean): void {
    if (captured) {
        // Marked only now: posthog-node skips an error that carries the marker when it is asked to capture it.
        setMarker(error, PREVIOUSLY_CAPTURED_ERROR_KEY, true)
    }
    setMarker(error, PROXY_CAPTURE_KEY, undefined)
}

function isPreviouslyCapturedError(error: unknown): boolean {
    return (
        isObjectLike(error) && (error as ErrorTracking.PreviouslyCapturedError)[PREVIOUSLY_CAPTURED_ERROR_KEY] === true
    )
}

function hasMarker(error: unknown, key: string): boolean {
    return isObjectLike(error) && (error as Record<string, unknown>)[key] === true
}

// String keys rather than a WeakSet or a Symbol: Next.js loads a separate copy of this module per bundle, and the
// marker must be visible to all of them. Non-enumerable, so it never shows up in the error's own properties.
function setMarker(error: unknown, key: string, value: true | undefined): void {
    if (!isObjectLike(error)) {
        return
    }
    try {
        if (isUndefined(value)) {
            delete (error as Record<string, unknown>)[key]
        } else {
            Object.defineProperty(error, key, { value, configurable: true, enumerable: false, writable: true })
        }
    } catch {
        // A frozen or non-extensible error cannot be marked.
    }
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
    now: number,
    sessionIdleTimeoutMs: number
): ReturnType<typeof buildContextData> {
    const distinctId = getTracingHeader(headers, POSTHOG_DISTINCT_ID_HEADER)
    const sessionId = getTracingHeader(headers, POSTHOG_SESSION_ID_HEADER)
    // A window belongs to the session it was sent with, so the window id is used only with the header session id.
    const windowId = sessionId ? getTracingHeader(headers, POSTHOG_WINDOW_ID_HEADER) : undefined
    const activeCookieState = cookieState
        ? { ...cookieState, sessionId: getActiveSessionId(cookieState, now, sessionIdleTimeoutMs) }
        : null
    return buildContextData({ distinctId, sessionId, windowId }, activeCookieState)
}

function getSessionIdleTimeoutMs(seconds: number | undefined): number {
    // Like posthog-js, a missing or zero timeout means the default.
    const timeout = isNumber(seconds) && seconds ? seconds : DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS
    return Math.min(Math.max(timeout, MIN_SESSION_IDLE_TIMEOUT_SECONDS), MAX_SESSION_IDLE_TIMEOUT_SECONDS) * 1000
}

// The cookie's timestamps come from the browser's clock. A browser clock that runs behind the server's makes a
// session look idle for longer than it was; one that runs ahead keeps it, as a future timestamp is not idle time.
function getActiveSessionId(state: PostHogCookieState, now: number, idleTimeoutMs: number): string | undefined {
    const { sessionId, sessionLastActivityTimestamp, sessionStartTimestamp } = state
    if (!sessionId || isUndefined(sessionLastActivityTimestamp)) {
        return undefined
    }
    if (now - sessionLastActivityTimestamp > idleTimeoutMs) {
        return undefined
    }
    // posthog-js versions from before June 2022 wrote $sesid without the start timestamp; posthog-js then skips the
    // length check too.
    if (!isUndefined(sessionStartTimestamp) && now - sessionStartTimestamp > SESSION_MAX_LENGTH_MS) {
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

    const path = normalizeRequestPath(request, context, shouldStripUrlHash)
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

function normalizeRequestPath(
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    shouldStripUrlHash: boolean
): string | undefined {
    const explicitPath = normalizeString(request.path)
    if (explicitPath) {
        const path = normalizePathValue(explicitPath, shouldStripUrlHash)
        // Next.js removes the basePath from the path it reports for renders, route handlers and server actions.
        // For middleware and proxy errors it reports the path of the request URL, which keeps it.
        return isProxyContext(context) ? path : addBasePath(path)
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

function isProxyContext(context: NextRequestErrorContext): boolean {
    return context.routeType === 'middleware' || context.routeType === 'proxy'
}

function addBasePath(path: string): string {
    const basePath = getBasePath()
    if (!basePath || !path.startsWith('/')) {
        return path
    }
    return path === '/' ? basePath : `${basePath}${path}`
}

// Next.js inlines its basePath into server and edge bundles. This package is bundled with the app, so the
// reference below is replaced at build time; it stays undefined when the package is not bundled.
function getBasePath(): string {
    const basePath = typeof process !== 'undefined' ? process.env.__NEXT_ROUTER_BASEPATH : undefined
    return typeof basePath === 'string' && basePath.startsWith('/') ? basePath.replace(/\/+$/, '') : ''
}

// The path has no query string, so neither does the URL. Behind a proxy, X-Forwarded-Host and X-Forwarded-Proto
// name what the browser used; Next.js fills both in from the request when nothing in front of it does.
function buildCurrentUrl(request: NextRequestErrorRequest, path: string): string | undefined {
    if (!path.startsWith('/')) {
        return undefined
    }

    const absoluteUrl = parseAbsoluteUrl(request.url)
    const host =
        getFirstForwardedValue(request.headers, 'x-forwarded-host') ??
        getFirstHeader(request.headers, 'host') ??
        absoluteUrl?.host
    if (!host) {
        return undefined
    }

    const forwardedProtocol = getFirstForwardedValue(request.headers, 'x-forwarded-proto')?.toLowerCase()
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

// The first value of a comma-separated X-Forwarded-* header, which the proxy nearest the browser set.
function getFirstForwardedValue(headers: HeadersLike, name: string): string | undefined {
    return normalizeString(getFirstHeader(headers, name)?.split(',')[0])
}

// Header names are lowercase in what Next.js passes, but a plain record from elsewhere may use any case.
function getRawHeader(headers: HeadersLike, name: string): HeaderValue {
    if (!headers || typeof headers !== 'object') {
        return undefined
    }

    const getter = (headers as { get?: unknown }).get
    if (isFunction(getter)) {
        return getter.call(headers, name) ?? getter.call(headers, name.toLowerCase())
    }

    const record = headers as Record<string, HeaderValue>
    const lowerName = name.toLowerCase()
    if (!isUndefined(record[lowerName])) {
        return record[lowerName]
    }
    const key = Object.keys(record).find((recordKey) => recordKey.toLowerCase() === lowerName)
    return isUndefined(key) ? undefined : record[key]
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
