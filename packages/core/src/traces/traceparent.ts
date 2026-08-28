import { isValidSpanId, isValidTraceId } from './ids'

export interface RemoteSpanContext {
  traceId: string
  spanId: string
}

// `00-<32 hex>-<16 hex>-<2 hex>`. Version `ff` is invalid per the spec; other
// unknown versions are forwards-compatible, so we parse the first four fields only.
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/

/**
 * Parses an incoming `traceparent` header value, returning `undefined` for
 * anything malformed so a bad header starts a fresh root rather than throwing.
 *
 * Incoming trace flags are deliberately ignored: we continue the trace even when
 * the caller sampled it out (`00`), because PostHog records every captured span
 * and dropping the parentage would orphan our own spans.
 */
export function parseTraceparent(value: unknown): RemoteSpanContext | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const match = TRACEPARENT_RE.exec(value.trim().toLowerCase())
  if (!match) {
    return undefined
  }
  const [, version, traceId, spanId] = match
  if (version === 'ff') {
    return undefined
  }
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) {
    return undefined
  }
  return { traceId, spanId }
}

/**
 * Builds the `traceparent` header value for a span. The sampled flag is always
 * set, because a span we exported is by definition recorded.
 */
export function formatTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`
}

// tracestate is a comma-separated list of at most 32 `key=value` members, and
// is carried opaquely — we never interpret the vendor entries.
const TRACESTATE_MAX_MEMBERS = 32
const TRACESTATE_MAX_LENGTH = 512

/**
 * Validates an incoming `tracestate` far enough to know it is safe to echo back.
 * An invalid one is discarded without invalidating its traceparent, so a
 * malformed vendor entry never costs us the trace continuation.
 */
export function sanitizeTracestate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > TRACESTATE_MAX_LENGTH) {
    return undefined
  }
  // W3C restricts tracestate to printable ASCII plus HTAB as optional whitespace.
  // A CRLF would make the caller's own propagation throw, and a lone surrogate
  // refuses the whole OTLP request.
  if (/[^\x20-\x7e\t]/.test(trimmed)) {
    return undefined
  }
  const members = trimmed.split(',')
  if (members.length > TRACESTATE_MAX_MEMBERS) {
    return undefined
  }
  for (const member of members) {
    // An empty member is tolerated by the spec (list optional-white-space), but
    // a member without a `=` is not a key/value pair at all.
    if (member.trim() && !member.includes('=')) {
      return undefined
    }
  }
  return trimmed
}
