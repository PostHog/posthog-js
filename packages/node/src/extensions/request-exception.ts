import ErrorTracking from './error-tracking'
import type { PostHogBackendClient } from '../client'
import type { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import type { ContextData } from './context/types'
import {
  addProperty,
  getPostHogCookieReadOptions,
  isPostHogCookieOptedOut,
  readPostHogCookieValues,
  sanitizeTracingHeaderValue,
  POSTHOG_TRACING_HEADERS,
} from './tracing-headers'
import { normalizeRequestPath } from './url-utils'

export interface CaptureRequestExceptionOptions {
  /**
   * The page URL to report instead of `request.url`, for frameworks whose error hook receives an internal request
   * (a data endpoint, for example). Only its origin and path are sent.
   */
  url?: string
  /** The person to link. Used even when the visitor opted out, because the app chose it. */
  distinctId?: string
  /** Extra event properties. They win over the request's, but cannot override the `$exception_*` properties. */
  properties?: Record<string, any>
  /** How the error reached the framework. Defaults to `{ type: 'middleware', handled: false }`. */
  mechanism?: { type?: string; handled?: boolean }
  /** `$exception_source`, as lowercase `<technology>.<hook>`, for example `sveltekit.handle_error`. */
  source?: string
}

interface RequestExceptionContext {
  distinctId?: string
  properties: Record<string, any>
  /** The distinct ID is an anonymous visitor's, from the cookie. */
  personless: boolean
  optedOut: boolean
}

// The errors captured per request and project. Hooks that see one error for one request capture it once; a later
// request that throws the same object (a cached rejected promise, for example) is a new occurrence.
const capturedByRequest = new WeakMap<Request, Map<string, WeakSet<object>>>()

/** Records the capture, and returns false when this error was already captured for this request and project. */
function claimRequestCapture(posthog: PostHogBackendClient, error: unknown, request: Request): boolean {
  if (ErrorTracking.isPreviouslyCapturedError(error)) {
    return false
  }
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function') {
    return true
  }
  const destination = `${posthog.apiKey}@${posthog.host}`
  let byDestination = capturedByRequest.get(request)
  if (!byDestination) {
    byDestination = new Map()
    capturedByRequest.set(request, byDestination)
  }
  let captured = byDestination.get(destination)
  if (!captured) {
    captured = new WeakSet()
    byDestination.set(destination, captured)
  }
  if (captured.has(error)) {
    return false
  }
  captured.add(error)
  return true
}

// Context fields that describe the visitor, left out when the visitor opted out.
const VISITOR_CONTEXT_PROPERTIES = ['$session_id', '$window_id', '$user_agent', '$ip']

/** The active context without the visitor's identity, session, user agent and IP. */
function withoutVisitor(context: ContextData | undefined): ContextData | undefined {
  if (!context) {
    return undefined
  }
  const { distinctId: _distinctId, sessionId: _sessionId, properties, ...rest } = context
  const kept = Object.fromEntries(
    Object.entries(properties ?? {}).filter(([key]) => !VISITOR_CONTEXT_PROPERTIES.includes(key))
  )
  return { ...rest, properties: kept }
}

function headerValue(headers: Headers, name: string): string | undefined {
  return sanitizeTracingHeaderValue(headers.get(name) ?? undefined)
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/**
 * The person, session and request properties for an exception raised while handling a fetch API `Request`.
 *
 * Identity, first match wins per field: the `distinctId` option, the active context (ids set by `withContext` or a
 * PostHog middleware), the `x-posthog-*` tracing headers, then the posthog-js cookie. The cookie is read only when the
 * client's `readPostHogCookie` option is on and the request has no tracing header; an anonymous cookie id is used too,
 * and the event stays personless. When the visitor's consent cookie opts out, only the `distinctId` option is used, and
 * the session and user agent are left out.
 */
function getRequestExceptionContext(
  posthog: PostHogBackendClient,
  request: Request,
  options: CaptureRequestExceptionOptions
): RequestExceptionContext {
  const cookieOptions = getPostHogCookieReadOptions(posthog)
  const cookieHeader = request.headers.get('cookie') ?? undefined
  const optedOut = isPostHogCookieOptedOut(
    cookieHeader,
    posthog.apiKey,
    cookieOptions?.optOutCapturingByDefault === true
  )

  const properties: Record<string, any> = {}
  let distinctId = options.distinctId
  let personless = false
  if (!optedOut) {
    const readHeaders = posthog.options.captureTracingHeaders !== false
    const header = {
      distinctId: readHeaders ? headerValue(request.headers, POSTHOG_TRACING_HEADERS.distinctId) : undefined,
      sessionId: readHeaders ? headerValue(request.headers, POSTHOG_TRACING_HEADERS.sessionId) : undefined,
    }
    const context = posthog.getContext()
    // One request never mixes a tracing header identity with the cookie's.
    const cookie =
      cookieOptions && header.distinctId === undefined && header.sessionId === undefined && cookieHeader
        ? readPostHogCookieValues({ cookie: cookieHeader }, cookieOptions, true)
        : {}
    if (distinctId === undefined) {
      distinctId = context?.distinctId ?? header.distinctId
      if (distinctId === undefined && cookie.distinctId !== undefined) {
        distinctId = cookie.distinctId
        // An anonymous visitor stays personless, as posthog-js keeps them with `person_profiles: 'identified_only'`.
        personless = cookie.anonymous === true
      }
    }
    addProperty(properties, '$session_id', context?.sessionId ?? header.sessionId ?? cookie.sessionId)
    addProperty(properties, '$user_agent', request.headers.get('user-agent') ?? undefined)
  }

  const url = parseUrl(options.url ?? request.url)
  addProperty(properties, '$current_url', url ? `${url.origin}${url.pathname}` : undefined)
  addProperty(properties, '$request_method', request.method)
  addProperty(
    properties,
    '$request_path',
    url ? normalizeRequestPath(url.pathname, posthog.options.disableCaptureUrlHashes === true) : undefined
  )

  return { ...(distinctId !== undefined ? { distinctId } : {}), properties, personless, optedOut }
}

/**
 * Captures an exception a framework caught while handling a fetch API `Request`, for frameworks whose error hook
 * receives the request (SvelteKit, Astro or TanStack Start, for example). The event carries the request's person,
 * session and request properties, and is marked unhandled with the `middleware` mechanism unless `options` say
 * otherwise. The query string is never sent.
 *
 * Identity, first match wins: the `distinctId` option, the active context, the `x-posthog-*` tracing headers, then the
 * posthog-js cookie. Linking page loads, which carry only the cookie, needs the client's `readPostHogCookie: true`.
 * When the visitor's consent cookie opts out, the event keeps no person, session or user agent, even from the active
 * context. Properties in `options` win over the request's.
 *
 * An error object is captured once per request and project, however many hooks pass it here. A later request that
 * throws the same object is captured again. Capturing an error with `posthog.captureException` and then rethrowing it
 * into the framework captures it twice.
 *
 * The returned promise resolves once the event is queued. When the client has a `waitUntil` option, the capture is
 * handed to it, so a serverless runtime stays alive until it is queued and flushed.
 *
 * @experimental Subject to change in a minor release.
 *
 * @example
 * ```ts
 * // SvelteKit hooks.server.ts: SvelteKit also calls handleError for 404s, which `status` tells apart.
 * export const handleError: HandleServerError = async ({ error, event, status }) => {
 *   if (status >= 500) {
 *     await captureRequestException(posthog, error, event.request, { source: 'sveltekit.handle_error' })
 *   }
 * }
 * ```
 */
export function captureRequestException(
  posthog: PostHogBackendClient,
  error: unknown,
  request: Request,
  options: CaptureRequestExceptionOptions = {}
): Promise<void> {
  try {
    if (!claimRequestCapture(posthog, error, request)) {
      return Promise.resolve()
    }
    const { distinctId, properties, personless, optedOut } = getRequestExceptionContext(posthog, request, options)
    const hint: CoreErrorTracking.EventHint = {
      mechanism: { type: options.mechanism?.type ?? 'middleware', handled: options.mechanism?.handled ?? false },
      syntheticException: new Error('PostHog syntheticException'),
    }
    const source = options.source
    const context = optedOut ? withoutVisitor(posthog.getContext()) : posthog.getContext()
    // An event option beats context and registered options; an explicit `$process_person_profile` property wins.
    const keepPersonless = personless && options.properties?.$process_person_profile === undefined
    const queued = posthog._captureIntegrationException(error, () =>
      ErrorTracking.buildEventMessage(
        posthog.getErrorPropertiesBuilder(),
        error,
        hint,
        distinctId,
        { ...properties, ...options.properties },
        undefined,
        context
      ).then((msg) => ({
        ...msg,
        ...(source ? { properties: { ...msg.properties, $exception_source: source } } : {}),
        ...(keepPersonless ? { options: { ...msg.options, process_person_profile: false } } : {}),
      }))
    )
    const waitUntil = posthog.options.waitUntil
    if (waitUntil) {
      try {
        waitUntil(queued)
      } catch {
        // waitUntil may throw outside a request context
      }
    }
    return queued
  } catch {
    // Capturing must never break the app's error handling.
    return Promise.resolve()
  }
}
