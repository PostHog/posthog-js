import type { RequestHeaderBag } from '../types'

/**
 * Reads the HTTP request headers off the `extra` (v1) / `ctx` (v2) object the
 * MCP SDK hands a request handler, and returns them as a plain object with
 * lowercase keys. Returns `undefined` when the request did not come over HTTP —
 * stdio and in-memory transports carry no headers at all.
 *
 * The two SDK majors put them in different places and in different shapes: v1
 * attaches a plain object at `extra.requestInfo.headers`, while v2 attaches the
 * WHATWG `Request` at `ctx.http.req`, whose `headers` is a `Headers` instance
 * that only answers to `.get()`. A v1-shaped read returns `undefined` on v2,
 * which is why this exists.
 *
 * Normalisation is **by shape, not by source**: a framework is free to hand us a
 * plain object where the SDK hands `Headers`, so both fields are checked for
 * both shapes. `Headers` is duck-typed on `.entries` rather than `instanceof` —
 * workerd and other edge runtimes are a different realm and would fail the
 * identity check on a perfectly good object.
 *
 * Exported from the package for host callbacks. `identify`, `intentFallback`,
 * `eventProperties` and `beforeSend` receive the SDK's `extra` unchanged — we
 * deliberately do not synthesise a v1 shape on v2, because a fabricated
 * `requestInfo` is a convincing partial lie about a shape the SDK removed on
 * purpose. So a host that reads headers reads them through this instead:
 *
 * ```ts
 * import { getRequestHeaders } from '@posthog/mcp'
 *
 * identify: async (request, extra) => {
 *   const auth = getRequestHeaders(extra)?.['authorization']
 *   // ...
 * }
 * ```
 */
export function getRequestHeaders(extra: unknown): RequestHeaderBag | undefined {
  if (!extra || typeof extra !== 'object') {
    return undefined
  }
  const record = extra as Record<string, unknown>
  const http = record.http as { req?: { headers?: unknown } } | undefined
  const requestInfo = record.requestInfo as { headers?: unknown } | undefined
  const source = http?.req?.headers ?? requestInfo?.headers
  if (!source || typeof source !== 'object') {
    return undefined
  }
  return toHeaderBag(source)
}

/**
 * Flattens either shape into a lowercase-keyed bag. Never throws: a header read
 * failing must not take a tool call down with it.
 */
function toHeaderBag(source: object): RequestHeaderBag | undefined {
  try {
    const entries = isHeadersLike(source) ? [...source.entries()] : Object.entries(source)
    const bag: RequestHeaderBag = {}
    for (const [key, value] of entries) {
      if (typeof key !== 'string' || value === undefined || value === null) {
        continue
      }
      if (typeof value === 'string' || Array.isArray(value)) {
        bag[key.toLowerCase()] = value as string | string[]
      }
    }
    return bag
  } catch {
    return undefined
  }
}

/** Duck-typed, never `instanceof` — an edge runtime's `Headers` is another realm's class. */
function isHeadersLike(source: object): source is { entries(): Iterable<[string, string]> } {
  const candidate = source as { entries?: unknown; get?: unknown }
  return typeof candidate.entries === 'function' && typeof candidate.get === 'function'
}
