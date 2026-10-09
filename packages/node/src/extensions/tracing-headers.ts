import type { IncomingHttpHeaders } from 'node:http'
import { cookieStoreFromHeader, getPostHogCookieName, isOptedOut } from '@posthog/core'

const TRACING_HEADER_MAX_LENGTH = 1000
// posthog-js defaults. The browser starts a new session after this much inactivity or session length.
const COOKIE_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const COOKIE_SESSION_MAX_LENGTH_MS = 24 * 60 * 60 * 1000
const MIN_SESSION_IDLE_TIMEOUT_SECONDS = 60
const MAX_SESSION_IDLE_TIMEOUT_SECONDS = 10 * 60 * 60
// Remove C0 controls, DEL, and C1 controls from PostHog tracing IDs only.
// oxlint-disable-next-line no-control-regex
const TRACING_HEADER_CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f-\x9f]/g

type HeaderValue = IncomingHttpHeaders[string]

export const POSTHOG_TRACING_HEADERS = {
  sessionId: 'x-posthog-session-id',
  distinctId: 'x-posthog-distinct-id',
} as const

export interface PostHogCookieReadOptions {
  apiKey: string
  sessionIdleTimeoutSeconds?: number
  optOutCapturingByDefault?: boolean
}

/**
 * The cookie read settings from the client's `readPostHogCookie` option, or undefined when the option is off.
 */
export function getPostHogCookieReadOptions(posthog: {
  apiKey: string
  options: { readPostHogCookie?: boolean | { sessionIdleTimeoutSeconds?: number; optOutCapturingByDefault?: boolean } }
}): PostHogCookieReadOptions | undefined {
  const option = posthog.options.readPostHogCookie
  if (option === true) {
    return { apiKey: posthog.apiKey }
  }
  if (option && typeof option === 'object') {
    return {
      apiKey: posthog.apiKey,
      sessionIdleTimeoutSeconds: option.sessionIdleTimeoutSeconds,
      optOutCapturingByDefault: option.optOutCapturingByDefault,
    }
  }
  return undefined
}

export interface PostHogTracingHeaderValues {
  sessionId?: string
  distinctId?: string
}

export function addProperty(properties: Record<string, any>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') {
    properties[key] = value
  }
}

export function getFirstHeaderValue(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function sanitizeTracingHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const sanitized = sanitizeTracingHeaderValue(item)
      if (sanitized !== undefined) {
        return sanitized
      }
    }
    return undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const sanitized = value.replace(TRACING_HEADER_CONTROL_CHARS_REGEX, '').trim()
  if (!sanitized) {
    return undefined
  }

  return sanitized.length > TRACING_HEADER_MAX_LENGTH ? sanitized.slice(0, TRACING_HEADER_MAX_LENGTH) : sanitized
}

function isRecent(timestamp: unknown, now: number, maxAgeMs: number): boolean {
  // Math.abs, like posthog-js, so a browser clock that runs ahead cannot keep a session alive.
  return typeof timestamp === 'number' && Number.isFinite(timestamp) && Math.abs(now - timestamp) <= maxAgeMs
}

/**
 * Reads the live session ID, and the distinct ID of an identified user, from the cookie that posthog-js writes with its
 * default persistence. The browser sends it on every same-site request, so backend events link to the browser session
 * without `tracing_headers`. A session past the posthog-js idle timeout or length cap is not returned, because the
 * browser starts a new session on its next activity. An anonymous distinct ID is not returned, so backend events for
 * anonymous visitors stay personless. Nothing is returned when the visitor's consent cookie opts out.
 */
export function getPostHogCookieValues(
  cookieHeader: HeaderValue,
  apiKey: string,
  now: number = Date.now(),
  sessionIdleTimeoutMs: number = COOKIE_SESSION_IDLE_TIMEOUT_MS,
  optOutCapturingByDefault: boolean = false
): PostHogTracingHeaderValues {
  try {
    if (typeof cookieHeader !== 'string') {
      return {}
    }
    const cookies = cookieStoreFromHeader(cookieHeader)
    const raw = cookies.get(getPostHogCookieName(apiKey))?.value
    if (!raw || isOptedOut(cookies, apiKey, { opt_out_capturing_by_default: optOutCapturingByDefault })) {
      return {}
    }
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') {
      return {}
    }

    const distinctId = data.$user_state === 'identified' ? sanitizeTracingHeaderValue(data.distinct_id) : undefined
    let sessionId: string | undefined
    const session = data.$sesid
    if (Array.isArray(session) && (session.length === 2 || session.length === 3)) {
      // Older posthog-js versions stored [lastActivity, sessionId] and start the session at lastActivity.
      const [lastActivity, candidate, sessionStart = lastActivity] = session
      if (
        isRecent(lastActivity, now, sessionIdleTimeoutMs) &&
        isRecent(sessionStart, now, COOKIE_SESSION_MAX_LENGTH_MS)
      ) {
        sessionId = sanitizeTracingHeaderValue(candidate)
      }
    }

    return {
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(distinctId !== undefined ? { distinctId } : {}),
    }
  } catch {
    return {}
  }
}

function getSessionIdleTimeoutMs(cookie: PostHogCookieReadOptions): number {
  const seconds = cookie.sessionIdleTimeoutSeconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return COOKIE_SESSION_IDLE_TIMEOUT_MS
  }
  // The same bounds posthog-js applies to session_idle_timeout_seconds.
  return Math.min(Math.max(seconds, MIN_SESSION_IDLE_TIMEOUT_SECONDS), MAX_SESSION_IDLE_TIMEOUT_SECONDS) * 1000
}

/**
 * Reads the PostHog tracing headers. With cookie read options, a request with neither header falls back to the posthog-js
 * cookie. A request with either header uses headers only, so one request never mixes two identities.
 */
export function getPostHogTracingHeaderValues(
  headers?: IncomingHttpHeaders,
  cookie?: PostHogCookieReadOptions
): PostHogTracingHeaderValues {
  if (!headers) {
    return {}
  }

  const headerSessionId = sanitizeTracingHeaderValue(headers[POSTHOG_TRACING_HEADERS.sessionId])
  const headerDistinctId = sanitizeTracingHeaderValue(headers[POSTHOG_TRACING_HEADERS.distinctId])
  const { sessionId, distinctId } =
    headerSessionId === undefined && headerDistinctId === undefined && cookie
      ? getPostHogCookieValues(
          headers.cookie,
          cookie.apiKey,
          Date.now(),
          getSessionIdleTimeoutMs(cookie),
          cookie.optOutCapturingByDefault === true
        )
      : { sessionId: headerSessionId, distinctId: headerDistinctId }

  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(distinctId !== undefined ? { distinctId } : {}),
  }
}
