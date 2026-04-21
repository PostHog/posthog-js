import { isArray, isFunction } from '@posthog/core'
import type { PostHog } from './posthog-rn'

const DISTINCT_ID_HEADER = 'X-POSTHOG-DISTINCT-ID'
const SESSION_ID_HEADER = 'X-POSTHOG-SESSION-ID'

const parseHostname = (url: string): string | undefined => {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

const shouldAddHeaders = (url: string, hostnames: string[]): boolean => {
  if (!isArray(hostnames)) {
    return false
  }
  const hostname = parseHostname(url)
  if (!hostname) {
    return false
  }
  return hostnames.includes(hostname)
}

type FetchFn = typeof fetch

export const patchFetchForTracingHeaders = (instance: PostHog, hostnames: string[]): (() => void) => {
  const globalAny = globalThis as unknown as { fetch?: FetchFn }
  const originalFetch = globalAny.fetch
  if (!isFunction(originalFetch)) {
    return () => {}
  }

  const wrappedFetch: FetchFn = async function (input, init) {
    try {
      const urlString =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request)?.url
      if (urlString && shouldAddHeaders(urlString, hostnames)) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
        const distinctId = instance.getDistinctId()
        const sessionId = instance.getSessionId()
        if (distinctId) {
          headers.set(DISTINCT_ID_HEADER, distinctId)
        }
        if (sessionId) {
          headers.set(SESSION_ID_HEADER, sessionId)
        }
        init = { ...(init ?? {}), headers }
      }
    } catch {
      // If anything goes wrong, fall through to the original fetch without tracing headers.
    }
    return originalFetch.call(globalAny, input, init)
  }

  globalAny.fetch = wrappedFetch

  return () => {
    if (globalAny.fetch === wrappedFetch) {
      globalAny.fetch = originalFetch
    }
  }
}
