import ErrorTracking from './error-tracking'
import type { PostHogBackendClient } from '../client'
import type { ErrorTracking as CoreErrorTracking } from '@posthog/core'
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
  /** Extra event properties. They cannot override the `$exception_*` properties. */
  properties?: Record<string, any>
  /** How the error reached the framework. Defaults to `{ type: 'middleware', handled: false }`. */
  mechanism?: { type?: string; handled?: boolean }
  /** `$exception_source`, as lowercase `<technology>.<hook>`, for example `sveltekit.handle_error`. */
  source?: string
}

interface RequestExceptionContext {
  distinctId?: string
  properties: Record<string, any>
}

// Errors captured here that could not carry the marker (frozen objects).
const capturedUnmarkable = new WeakSet<object>()

/** Whether a PostHog integration already captured this error object. */
function wasCapturedByPostHog(error: unknown): boolean {
  return (
    ErrorTracking.isPreviouslyCapturedError(error) ||
    (typeof error === 'object' && error !== null && capturedUnmarkable.has(error))
  )
}

function markCaptured(error: unknown): void {
  if (typeof error !== 'object' || error === null) {
    return
  }
  try {
    Object.defineProperty(error, '__posthog_previously_captured_error', {
      value: true,
      enumerable: false,
      configurable: true,
      writable: true,
    })
  } catch {
    capturedUnmarkable.add(error)
  }
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
 * Identity, first match wins per field: the `distinctId` option, the `x-posthog-*` tracing headers, the active
 * context (ids set by `withContext` or a PostHog middleware), then the posthog-js cookie. The cookie is read only when
 * the client's `readPostHogCookie` option is on and the request has no tracing header; an anonymous cookie id is used
 * too, with `$process_person_profile: false`. When the visitor's consent cookie opts out, only the `distinctId` option
 * is used, and the session and user agent are left out.
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
    const cookieDistinctId = context?.distinctId === undefined ? cookie.distinctId : undefined
    distinctId ??= header.distinctId ?? context?.distinctId ?? cookieDistinctId
    if (distinctId !== undefined && distinctId === cookieDistinctId && cookie.anonymous) {
      // An anonymous visitor stays personless, as posthog-js keeps them with `person_profiles: 'identified_only'`.
      properties.$process_person_profile = false
    }
    addProperty(properties, '$session_id', header.sessionId ?? context?.sessionId ?? cookie.sessionId)
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

  return { ...(distinctId !== undefined ? { distinctId } : {}), properties }
}

/**
 * Captures an exception a framework caught while handling a fetch API `Request`, for frameworks whose error hook
 * receives the request (SvelteKit, Astro or TanStack Start, for example). The event carries the request's person,
 * session and request properties, and is marked unhandled with the `middleware` mechanism unless `options` say
 * otherwise. The query string is never sent.
 *
 * Identity, first match wins: the `distinctId` option, the `x-posthog-*` tracing headers, the active context, then the
 * posthog-js cookie. Linking page loads, which carry only the cookie, needs the client's `readPostHogCookie: true`.
 * When the visitor's consent cookie opts out, the event keeps no person, session or user agent.
 *
 * An error object is captured once: after capture it is marked, and later calls (and other PostHog integrations that
 * check the mark) skip it. `posthog.captureException` does not mark errors, so capturing one there and then rethrowing
 * it into the framework captures it twice.
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
    if (wasCapturedByPostHog(error)) {
      return Promise.resolve()
    }
    markCaptured(error)
    const { distinctId, properties } = getRequestExceptionContext(posthog, request, options)
    const hint: CoreErrorTracking.EventHint = {
      mechanism: { type: 'middleware', handled: false, ...options.mechanism },
      syntheticException: new Error('PostHog syntheticException'),
    }
    const source = options.source
    const queued = posthog._captureIntegrationException(error, () =>
      ErrorTracking.buildEventMessage(
        posthog.getErrorPropertiesBuilder(),
        error,
        hint,
        distinctId,
        { ...options.properties, ...properties },
        undefined,
        posthog.getContext()
      ).then((msg) => (source ? { ...msg, properties: { ...msg.properties, $exception_source: source } } : msg))
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
