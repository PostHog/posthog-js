import { ErrorTracking, isArray, isFunction, isNull, isUndefined, removeTrailingSlash } from '@posthog/core'
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
    captureImmediate(message: {
        event: string
        distinctId?: string
        properties?: Record<string, unknown>
        _originatedFromCaptureException?: boolean
    }): Promise<void>
    getErrorPropertiesBuilder(): ErrorTracking.ErrorPropertiesBuilder
}

type ServerOptions = NonNullable<OnRequestErrorOptions['serverOptions']>

type GetOrCreateClient = (apiKey: string, options?: ServerOptions) => Promise<PostHogExceptionCaptureClient>

type HeaderValue = string | string[] | null | undefined

type HeadersLike = NextRequestErrorRequest['headers']

// posthog-js ends a session after 30 minutes without activity, or 24 hours after it started. An app can change the 30
// minutes with posthog-js's `session_idle_timeout_seconds`, which the server cannot read, so the default applies here.
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const SESSION_MAX_LENGTH_MS = 24 * 60 * 60 * 1000

const TRACING_HEADER_MAX_LENGTH = 1000
// Remove C0 controls, DEL, and C1 controls from PostHog tracing IDs only.
// oxlint-disable-next-line no-control-regex
const TRACING_HEADER_CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f-\x9f]/g

const NEXT_DATA_ROUTE_REGEX = /^\/_next\/data\/[^/]+\/(.*)\.json$/

// The marker posthog-node checks before it captures an exception, so a marked error is captured only once.
const PREVIOUSLY_CAPTURED_ERROR_KEY = '__posthog_previously_captured_error'

// withPostHogProxy's mark on the errors it captures, so that onRequestError skips Next.js's report of them. A key on
// the error, as Sentry marks the errors it captures, so that every copy of this module sees it: Next.js loads one per
// bundle. Not posthog-node's marker: posthog-node skips an error that carries it, and the wrapper marks the error
// before posthog-node captures it.
const PROXY_CAPTURED_ERROR_KEY = '__posthog_proxy_captured_error'

export async function captureNextRequestError(
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    options: OnRequestErrorOptions,
    getOrCreateClient: GetOrCreateClient
): Promise<void> {
    // Only for middleware and proxy errors: a route handler that throws the same error object was not captured by
    // the wrapper.
    if (isPreviouslyCapturedError(error) || (isProxyContext(context) && isProxyCapturedError(error))) {
        return
    }
    await sendNextRequestError(error, request, context, options, getOrCreateClient)
}

/** Captures a request error whether or not it was captured before. */
export async function sendNextRequestError(
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    options: OnRequestErrorOptions,
    getOrCreateClient: GetOrCreateClient
): Promise<void> {
    if (options.disabled) {
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

    const identity = resolveRequestIdentity(request.headers, readPostHogCookie(cookieStore, apiKey))
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
        return
    }

    try {
        await (isProxyContext(context)
            ? captureUnhandledMiddlewareError(client, error, distinctId, properties)
            : client.captureExceptionImmediate(error, distinctId, properties))
    } catch (captureError) {
        // oxlint-disable-next-line no-console
        console.warn('[PostHog Next.js] Failed to capture server-side exception:', captureError)
    }
}

/**
 * An error that escapes a proxy or middleware is unhandled: Next.js answers the request with a 500. posthog-node's
 * captureExceptionImmediate marks every exception a handled manual capture, so the event is built as posthog-node's
 * Express integration builds one, with the middleware mechanism.
 */
async function captureUnhandledMiddlewareError(
    client: PostHogExceptionCaptureClient,
    error: unknown,
    distinctId: string | undefined,
    properties: Record<string, unknown>
): Promise<void> {
    const builder = client.getErrorPropertiesBuilder()
    const exceptionProperties = builder.buildFromUnknown(error, {
        mechanism: { type: 'middleware', handled: false },
        syntheticException: new Error('PostHog syntheticException'),
    })
    exceptionProperties.$exception_list = await builder.modifyFrames(exceptionProperties.$exception_list)
    const releaseId = ErrorTracking.getInjectedReleaseId()
    await client.captureImmediate({
        event: '$exception',
        distinctId,
        properties: { ...exceptionProperties, ...properties, ...(releaseId ? { $release_id: releaseId } : {}) },
        _originatedFromCaptureException: true,
    })
}

/** Whether withPostHogProxy captured the error. */
function isProxyCapturedError(error: unknown): boolean {
    return isObjectLike(error) && (error as Record<string, unknown>)[PROXY_CAPTURED_ERROR_KEY] === true
}

/**
 * Marks an error withPostHogProxy handles, so that onRequestError skips Next.js's report of it. A thrown primitive or
 * frozen object cannot be marked, so where Next.js reports it as well, it is captured twice.
 */
export function markProxyCapturedError(error: unknown): void {
    if (!isObjectLike(error)) {
        return
    }
    try {
        Object.defineProperty(error, PROXY_CAPTURED_ERROR_KEY, { value: true, configurable: true })
    } catch {
        // A frozen object.
    }
}

export function isPreviouslyCapturedError(error: unknown): boolean {
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
    cookieState: PostHogCookieState | null
): ReturnType<typeof buildContextData> {
    const distinctId = getTracingHeader(headers, POSTHOG_DISTINCT_ID_HEADER)
    const sessionId = getTracingHeader(headers, POSTHOG_SESSION_ID_HEADER)
    // A window belongs to the session it was sent with, so the window id is used only with the header session id.
    const windowId = sessionId ? getTracingHeader(headers, POSTHOG_WINDOW_ID_HEADER) : undefined
    const activeCookieState = cookieState ? { ...cookieState, sessionId: getActiveSessionId(cookieState) } : null
    return buildContextData({ distinctId, sessionId, windowId }, activeCookieState)
}

// The cookie's timestamps come from the browser's clock. A browser clock that runs behind the server's makes a session
// look idle for longer than it was. One that runs ahead keeps it: a future timestamp is not idle time. posthog-js takes
// the absolute difference, but against its own clock, where a future timestamp means the clock went back. posthog-js
// before June 2022 wrote $sesid without the start timestamp, and then skips the length check too.
function getActiveSessionId(state: PostHogCookieState): string | undefined {
    const { sessionId, sessionLastActivityTimestamp: lastActivity, sessionStartTimestamp: start } = state
    const now = Date.now()
    const active =
        !isUndefined(lastActivity) &&
        now - lastActivity <= SESSION_IDLE_TIMEOUT_MS &&
        (isUndefined(start) || now - start <= SESSION_MAX_LENGTH_MS)
    return active ? sessionId : undefined
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
    if (isProxyContext(context)) {
        properties.$exception_source = `nextjs.${context.routeType}`
    }
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
        // The same path has also lost its i18n locale, and nothing Next.js passes here says what it was, so a Pages
        // Router error on /fr/page is reported as /page.
        return isProxyContext(context) ? path : addBasePath(getDataRoutePage(path))
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

// A Pages Router `<Link>` fetches /_next/data/<buildId>/<page>.json, and Next.js reports that path. The build id
// changes with every deploy, so report the page the browser is on.
function getDataRoutePage(path: string): string {
    const page = NEXT_DATA_ROUTE_REGEX.exec(path)?.[1]
    if (isUndefined(page)) {
        return path
    }
    if (page === 'index') {
        return '/'
    }
    return hasTrailingSlash() ? `/${page}/` : `/${page}`
}

// Next.js passes the same path for a 404 inside the basePath and one outside it, so a render error on /wp-login.php
// is reported as /base/wp-login.php too.
function addBasePath(path: string): string {
    const basePath = getBasePath()
    if (!basePath || !path.startsWith('/')) {
        return path
    }
    if (path !== '/') {
        return `${basePath}${path}`
    }
    return hasTrailingSlash() ? `${basePath}/` : basePath
}

// Next.js inlines its basePath into server and edge bundles. This package is bundled with the app, so the
// reference below is replaced at build time; it stays undefined when the package is not bundled.
function getBasePath(): string {
    const basePath = typeof process !== 'undefined' ? process.env.__NEXT_ROUTER_BASEPATH : undefined
    return typeof basePath === 'string' && basePath.startsWith('/') ? removeTrailingSlash(basePath) : ''
}

// Inlined the same way, as a boolean rather than the string an environment variable would be.
function hasTrailingSlash(): boolean {
    return typeof process !== 'undefined' && String(process.env.__NEXT_TRAILING_SLASH) === 'true'
}

// The path has no query string, so neither does the URL. Behind a proxy, X-Forwarded-Host and X-Forwarded-Proto
// name what the browser used; Next.js fills both in from the request when nothing in front of it does.
function buildCurrentUrl(request: NextRequestErrorRequest, path: string): string | undefined {
    if (!path.startsWith('/')) {
        return undefined
    }

    const absoluteUrl = parseAbsoluteUrl(request.url)
    const forwardedProtocol = getFirstForwardedValue(request.headers, 'x-forwarded-proto')?.toLowerCase()
    const protocol = [forwardedProtocol, absoluteUrl?.protocol.slice(0, -1)].find(isHttpProtocol) ?? 'https'
    const hosts = [
        getFirstForwardedValue(request.headers, 'x-forwarded-host'),
        getFirstHeader(request.headers, 'host'),
        absoluteUrl?.host,
    ]
    for (const host of hosts) {
        if (!host) {
            continue
        }
        try {
            // oxlint-disable-next-line compat/compat
            return `${new URL(`${protocol}://${host}`).origin}${path}`
        } catch {
            // Not a host: try the next one.
        }
    }
    return undefined
}

export function parseAbsoluteUrl(value: unknown): URL | undefined {
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
