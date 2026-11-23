import ErrorTracking from './error-tracking'
import type { PostHogBackendClient } from '../client'
import type { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import { addProperty, getPostHogCookieReadOptions, readPostHogTracingHeaders } from './tracing-headers'
import { normalizeRequestPath } from './url-utils'

type PostHogForRequestExceptions = Pick<
  PostHogBackendClient,
  'apiKey' | 'options' | 'getContext' | 'getErrorPropertiesBuilder' | 'addPendingPromise' | '_capturePreparedEvent'
>

/** What a request tells PostHog about the person, the session and the page. */
export interface RequestExceptionContext {
  distinctId?: string
  sessionId?: string
  properties: Record<string, any>
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value
  })
  return record
}

function firstForwardedIp(headers: Headers): string | undefined {
  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return ip || undefined
}

/**
 * The person, session and request properties for an exception raised while handling a fetch API `Request`.
 * Identity: the active context (an id your own middleware set) first, then the tracing headers, then the posthog-js
 * cookie when the client's `readPostHogCookie` option is on. `$current_url` and `$request_path` drop the query string.
 */
export function getRequestExceptionContext(
  posthog: Pick<PostHogBackendClient, 'apiKey' | 'options' | 'getContext'>,
  request: Request
): RequestExceptionContext {
  const ids = readPostHogTracingHeaders(
    posthog.options,
    headersToRecord(request.headers),
    getPostHogCookieReadOptions(posthog)
  )
  const context = posthog.getContext()
  const distinctId = context?.distinctId ?? ids.distinctId
  const sessionId = context?.sessionId ?? ids.sessionId
  const disableCaptureUrlHashes = posthog.options.disableCaptureUrlHashes === true

  const properties: Record<string, any> = {}
  let url: URL | undefined
  try {
    url = new URL(request.url)
  } catch {
    url = undefined
  }
  addProperty(properties, '$current_url', url ? `${url.origin}${url.pathname}` : undefined)
  addProperty(properties, '$request_method', request.method)
  addProperty(
    properties,
    '$request_path',
    url ? normalizeRequestPath(url.pathname, disableCaptureUrlHashes) : undefined
  )
  addProperty(properties, '$user_agent', request.headers.get('user-agent') ?? undefined)
  addProperty(properties, '$ip', firstForwardedIp(request.headers))

  return {
    ...(distinctId !== undefined ? { distinctId } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    properties,
  }
}

/**
 * Captures an exception a framework caught while handling a fetch API `Request` (React Router `handleError`,
 * SvelteKit `handleError`, Astro or TanStack Start error hooks). The event carries the request's person and session
 * (see {@link getRequestExceptionContext}) and its request properties, and is marked unhandled with the
 * `middleware` mechanism, because the error escaped the app's code into the framework.
 *
 * @example
 * ```ts
 * export const handleError = ({ error, event }) => captureRequestException(posthog, error, event.request)
 * ```
 */
export function captureRequestException(posthog: PostHogForRequestExceptions, error: unknown, request: Request): void {
  if (ErrorTracking.isPreviouslyCapturedError(error)) {
    return
  }
  const { distinctId, sessionId, properties } = getRequestExceptionContext(posthog, request)
  const hint: CoreErrorTracking.EventHint = {
    mechanism: { type: 'middleware', handled: false },
    syntheticException: new Error('PostHog syntheticException'),
  }
  posthog.addPendingPromise(
    ErrorTracking.buildEventMessage(
      posthog.getErrorPropertiesBuilder(),
      error,
      hint,
      distinctId,
      { ...(sessionId !== undefined ? { $session_id: sessionId } : {}), ...properties },
      undefined,
      posthog.getContext()
    ).then((msg) => posthog._capturePreparedEvent(msg, false))
  )
}
