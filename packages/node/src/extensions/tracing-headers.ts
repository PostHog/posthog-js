import type { IncomingHttpHeaders } from 'node:http'
import { cookieStoreFromHeader, getPostHogCookieName, isOptedOut } from '@posthog/core'

const TRACING_HEADER_MAX_LENGTH = 1000
// posthog-js defaults. The browser starts a new session after this much inactivity or session length.
const COOKIE_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const COOKIE_SESSION_MAX_LENGTH_MS = 24 * 60 * 60 * 1000
// Remove C0 controls, DEL, and C1 controls from PostHog tracing IDs only.
// oxlint-disable-next-line no-control-regex
const TRACING_HEADER_CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f-\x9f]/g

type HeaderValue = IncomingHttpHeaders[string]

export const POSTHOG_TRACING_HEADERS = {
  sessionId: 'x-posthog-session-id',
  distinctId: 'x-posthog-distinct-id',
} as const

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
 * Reads the distinct ID and the live session ID from the cookie that posthog-js writes with its default persistence.
 * The browser sends it on every same-site request, so backend events link to the browser session without
 * `tracing_headers`. A session past the posthog-js idle timeout or length cap is not returned, because the browser
 * starts a new session on its next activity. Nothing is returned when the visitor's consent cookie opts out.
 */
export function getPostHogCookieValues(
  cookieHeader: HeaderValue,
  apiKey: string,
  now: number = Date.now()
): PostHogTracingHeaderValues {
  try {
    if (typeof cookieHeader !== 'string') {
      return {}
    }
    const cookies = cookieStoreFromHeader(cookieHeader)
    const raw = cookies.get(getPostHogCookieName(apiKey))?.value
    if (!raw || isOptedOut(cookies, apiKey)) {
      return {}
    }
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') {
      return {}
    }

    const distinctId = sanitizeTracingHeaderValue(data.distinct_id)
    let sessionId: string | undefined
    const session = data.$sesid
    if (Array.isArray(session) && session.length === 3) {
      const [lastActivity, candidate, sessionStart] = session
      if (
        isRecent(lastActivity, now, COOKIE_SESSION_IDLE_TIMEOUT_MS) &&
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

/**
 * Reads the PostHog tracing headers. With an `apiKey`, a missing header falls back to the posthog-js cookie.
 */
export function getPostHogTracingHeaderValues(
  headers?: IncomingHttpHeaders,
  apiKey?: string
): PostHogTracingHeaderValues {
  if (!headers) {
    return {}
  }

  const cookie = apiKey ? getPostHogCookieValues(headers.cookie, apiKey) : {}
  const sessionId = sanitizeTracingHeaderValue(headers[POSTHOG_TRACING_HEADERS.sessionId]) ?? cookie.sessionId
  const distinctId = sanitizeTracingHeaderValue(headers[POSTHOG_TRACING_HEADERS.distinctId]) ?? cookie.distinctId

  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(distinctId !== undefined ? { distinctId } : {}),
  }
}
