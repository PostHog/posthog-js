import { isValidSpanId, isValidTraceId } from './ids'

export interface RemoteSpanContext {
  traceId: string
  spanId: string
  /** The inbound trace-flags byte, e.g. `01` sampled, `00` sampled out. */
  flags: string
}

// Version `ff` is invalid per the spec, and a higher version may append fields
// after the first four, so the trailing group captures them rather than failing
// the match.
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/

/**
 * Parses an incoming `traceparent` header value, returning `undefined` for
 * anything malformed so a bad header starts a fresh root rather than throwing.
 *
 * A trace the caller sampled out (`00`) is still continued — PostHog records
 * every captured span — but the inbound flag rides along, so what this SDK
 * propagates onward says what the caller decided rather than overriding it.
 */
export function parseTraceparent(value: unknown): RemoteSpanContext | undefined {
  const fields = matchTraceparent(value)
  return fields && { traceId: fields.traceId, spanId: fields.spanId, flags: definedFlags(fields.flags) }
}

/**
 * Keeps only the flags version `00` defines — the sampled bit. A span continuing
 * this trace re-emits the byte under version `00`, and W3C requires a vendor to
 * zero every flag that version does not define rather than forward one it cannot
 * interpret.
 */
function definedFlags(flags: string): string {
  return parseInt(flags, 16) & 0x01 ? TRACE_FLAGS_SAMPLED : TRACE_FLAGS_UNSAMPLED
}

interface TraceparentFields {
  version: string
  traceId: string
  spanId: string
  flags: string
}

function matchTraceparent(value: unknown): TraceparentFields | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  // W3C spells every field lowercase hex and requires a vendor to ignore a
  // `traceparent` whose ids are not, so folding the case here would continue a
  // trace that a conformant peer restarts.
  const match = TRACEPARENT_RE.exec(value.trim())
  if (!match) {
    return undefined
  }
  const [, version, traceId, spanId, flags, trailing] = match
  if (version === 'ff') {
    return undefined
  }
  // Version `00` is defined as exactly `trace-id "-" parent-id "-" trace-flags`.
  // W3C scopes the tolerate-what-you-don't-know rule to a *higher* version, so a
  // version `00` header with anything appended is malformed.
  if (version === '00' && trailing) {
    return undefined
  }
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) {
    return undefined
  }
  return { version, traceId, spanId, flags }
}

/**
 * The inbound `traceparent` as received, or `undefined` when it is malformed.
 *
 * Returned whole rather than rebuilt: a version above `00` may append fields
 * this SDK does not read, and rebuilding would forward a header still labelled
 * with that version but missing what the version defines.
 */
export function normalizeTraceparent(value: unknown): string | undefined {
  return matchTraceparent(value) && (value as string).trim()
}

/** The W3C sampled bit, set on a trace this SDK started. */
export const TRACE_FLAGS_SAMPLED = '01'

/** The same byte with the sampled bit clear, for a trace the caller sampled out. */
const TRACE_FLAGS_UNSAMPLED = '00'

/**
 * Builds the `traceparent` header value for a span. A span continuing a remote
 * trace propagates the flags byte it was handed: a downstream parent-based
 * sampler must see the decision the head sampler actually made, not one this
 * SDK invented. A trace started here is sampled, because it is recorded.
 */
export function formatTraceparent(traceId: string, spanId: string, flags: string = TRACE_FLAGS_SAMPLED): string {
  return `00-${traceId}-${spanId}-${flags}`
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
