import { isFunction } from '@posthog/core'
import type { PostHog } from './posthog-rn'

const DISTINCT_ID_HEADER = 'X-POSTHOG-DISTINCT-ID'
const SESSION_ID_HEADER = 'X-POSTHOG-SESSION-ID'
const PATCH_MARKER = '__posthog_tracing_headers_patched__'

const parseHostname = (url: string): string | undefined => {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

const shouldAddHeaders = (url: string, hostnames: string[]): boolean => {
  const hostname = parseHostname(url)
  if (!hostname) {
    return false
  }
  return hostnames.includes(hostname)
}

type FetchFn = typeof fetch
type PatchedFetch = FetchFn & { [PATCH_MARKER]?: { original: FetchFn } }

export const patchFetchForTracingHeaders = (instance: PostHog, hostnames: string[]): (() => void) => {
  const globalAny = globalThis as unknown as { fetch?: PatchedFetch }
  const currentFetch = globalAny.fetch
  if (!isFunction(currentFetch)) {
    return () => {}
  }

  // If we already patched fetch ourselves, unwrap so the latest PostHog instance's hostname list
  // and session/distinct ids take effect without stacking patches.
  //
  // Limitation: we only unwrap our own immediate predecessor. If another library wraps fetch
  // between two PostHog inits, their wrapper has no PATCH_MARKER, so we treat it as the original —
  // meaning the earlier PostHog patch stays live underneath and headers could be written twice.
  // This is considered out of scope; we rely on PostHog being initialised once per app.
  const originalFetch: FetchFn = currentFetch[PATCH_MARKER]?.original ?? currentFetch

  const wrappedFetch: PatchedFetch = async function (input, init) {
    try {
      const urlString =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : undefined
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
        const initWithHeaders = { ...(init ?? {}), headers }
        return originalFetch.call(globalAny, input, initWithHeaders)
      }
    } catch {
      // If anything goes wrong, fall through to the original fetch without tracing headers.
    }
    return originalFetch.call(globalAny, input, init)
  }

  Object.defineProperty(wrappedFetch, PATCH_MARKER, {
    value: { original: originalFetch },
    enumerable: false,
  })

  globalAny.fetch = wrappedFetch

  return () => {
    if (globalAny.fetch === wrappedFetch) {
      globalAny.fetch = originalFetch
    }
  }
}
