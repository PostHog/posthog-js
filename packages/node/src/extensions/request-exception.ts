import ErrorTracking from './error-tracking'
import type { PostHogBackendClient } from '../client'
import type { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import type { ContextData } from './context/types'
import {
  addProperty,
  getPostHogCookieReadOptions,
  isPostHogCookieOptedOut,
  readPostHogTracingHeaders,
} from './tracing-headers'
import { normalizeRequestPath } from './url-utils'

export interface CaptureRequestExceptionOptions {
  /** `$exception_source`, as lowercase `<technology>.<hook>`, for example `react_router.handle_error`. */
  source: string
  /** The page URL to report instead of `request.url`, for an internal request (a data endpoint, for example). */
  url?: string
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
  const byProject = capturedByRequest.get(request) ?? new Map<string, WeakSet<object>>()
  capturedByRequest.set(request, byProject)
  const project = `${posthog.apiKey}@${posthog.host}`
  const captured = byProject.get(project) ?? new WeakSet<object>()
  byProject.set(project, captured)
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

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/**
 * Captures an exception a framework caught while handling a fetch API `Request`, with the request's person, session
 * and request properties, marked unhandled with the `middleware` mechanism. The query string is never sent.
 *
 * Identity, first match wins per field: the active context, the `x-posthog-*` tracing headers, then the posthog-js
 * cookie (with the client's `readPostHogCookie`), where an anonymous visitor's id keeps the event personless. When the
 * visitor's consent cookie opts out, the event keeps no person, session or user agent, even from the active context.
 *
 * An error object is captured once per request and project, however many hooks pass it here. When the client has a
 * `waitUntil` option, the capture is handed to it, so a serverless runtime stays alive until it is queued and flushed.
 * The returned promise resolves once the event is queued.
 */
export function captureRequestException(
  posthog: PostHogBackendClient,
  error: unknown,
  request: Request,
  options: CaptureRequestExceptionOptions
): Promise<void> {
  try {
    if (!claimRequestCapture(posthog, error, request)) {
      return Promise.resolve()
    }
    const cookieOptions = getPostHogCookieReadOptions(posthog)
    const optedOut = isPostHogCookieOptedOut(
      request.headers.get('cookie') ?? undefined,
      posthog.apiKey,
      cookieOptions?.optOutCapturingByDefault === true
    )
    const context = optedOut ? withoutVisitor(posthog.getContext()) : posthog.getContext()

    const properties: Record<string, any> = {}
    let distinctId: string | undefined
    let personless = false
    if (!optedOut) {
      const ids = readPostHogTracingHeaders(posthog.options, Object.fromEntries(request.headers), cookieOptions, true)
      distinctId = context?.distinctId ?? ids.distinctId
      // An anonymous visitor stays personless, as posthog-js keeps them with `person_profiles: 'identified_only'`.
      personless = distinctId === ids.distinctId && ids.anonymous === true
      addProperty(properties, '$session_id', context?.sessionId ?? ids.sessionId)
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

    const hint: CoreErrorTracking.EventHint = {
      mechanism: { type: 'middleware', handled: false },
      syntheticException: new Error('PostHog syntheticException'),
    }
    const queued = posthog._captureIntegrationException(error, () =>
      ErrorTracking.buildEventMessage(
        posthog.getErrorPropertiesBuilder(),
        error,
        hint,
        distinctId,
        properties,
        undefined,
        context
      ).then((msg) => ({
        ...msg,
        // Added after the build, which drops `$exception_*` properties.
        properties: { ...msg.properties, $exception_source: options.source },
        // An event option wins over the context's and registered options.
        ...(personless ? { options: { ...msg.options, process_person_profile: false } } : {}),
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
