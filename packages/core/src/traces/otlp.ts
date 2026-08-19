// OTLP encoding for spans.
//
// Deliberately not shared with the logs encoder: `logs-utils.toOtlpAnyValue`
// emits `intValue` as a JSON number and flattens objects to JSON strings, while
// the proto3 JSON mapping requires int64 fields as strings and OTLP has a real
// `kvlistValue` for maps.

import type {
  OtlpSpan,
  OtlpSpanAnyValue,
  OtlpSpanEvent,
  OtlpSpanKeyValue,
  OtlpTracesPayload,
  SpanAttributeValue,
  SpanAttributes,
  SpanKind,
  SpanStatusCode,
} from '@posthog/types'
import type { Logger } from '../types'
import type { ResolvedTracesConfig, SpanRecord } from './types'
import { isArray, isBoolean, isNullish } from '../utils'

// ============================================================================
// Enums
// ============================================================================

const SPAN_KIND_TO_OTLP: Record<SpanKind, number> = {
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
}

const SPAN_STATUS_TO_OTLP: Record<SpanStatusCode, number> = {
  ok: 1,
  error: 2,
}

/** W3C trace flags: the sampled bit, always set because v1 records every captured span. */
const TRACE_FLAGS_SAMPLED = 1

export function spanKindToOtlp(kind: SpanKind | undefined): number {
  return (kind && SPAN_KIND_TO_OTLP[kind]) || SPAN_KIND_TO_OTLP.internal
}

// ============================================================================
// Timestamps
// ============================================================================

/**
 * Converts a millisecond epoch to the unix-nanosecond string OTLP expects.
 *
 * Concatenation rather than multiplication: `Date.now() * 1e6` exceeds
 * `Number.MAX_SAFE_INTEGER` and would lose precision.
 */
export function msToUnixNanoString(ms: number): string {
  let whole = Math.floor(ms)
  let fractionalNanos = Math.round((ms - whole) * 1e6)
  // Rounding can carry into the next millisecond. Without this the padded
  // fraction gains a seventh digit and the concatenated timestamp is malformed,
  // which 400s the entire request — the exact failure client-side validity
  // exists to prevent.
  if (fractionalNanos >= 1e6) {
    whole += 1
    fractionalNanos = 0
  }
  return String(whole) + String(fractionalNanos).padStart(6, '0')
}

// ============================================================================
// AnyValue encoding
// ============================================================================

// proto3 JSON maps int64 to a string. A value outside the range is encoded as a
// decimal string instead — sending it as an `intValue` would 400 the entire
// batch, taking every other span in the request with it.
const INT64_MAX = 9223372036854775807n
const INT64_MIN = -9223372036854775808n
// 2^63 as a float; JS numbers at this magnitude are already imprecise, so the
// comparison is deliberately exclusive at the top.
const INT64_MAX_FLOAT = 9223372036854775808

const CIRCULAR_MARKER = '[Circular]'

function exactIntegerString(value: number): string {
  try {
    return BigInt(value).toString()
  } catch {
    return String(value)
  }
}

export function toOtlpAnyValue(
  value: SpanAttributeValue,
  logger?: Logger,
  // Containers on the current path, so a back-reference degrades to a marker
  // instead of recursing until the stack blows. Span attributes are ordinary
  // application objects — ORM entities and request objects routinely have one.
  seen?: WeakSet<object>
): OtlpSpanAnyValue {
  if (isBoolean(value)) {
    return { boolValue: value }
  }
  if (typeof value === 'bigint') {
    if (value > INT64_MAX || value < INT64_MIN) {
      logger?.debug(`Span attribute ${value} is outside the int64 range; encoding it as a string`)
      return { stringValue: String(value) }
    }
    return { intValue: String(value) }
  }
  if (typeof value === 'number') {
    // typeof rather than core's isNumber, which excludes NaN. JSON has no
    // representation for non-finite floats and JSON.stringify turns them into
    // `null`, losing the value; proto3 JSON requires the literal strings.
    if (!Number.isFinite(value)) {
      return { stringValue: String(value) }
    }
    if (Number.isInteger(value)) {
      if (value >= INT64_MAX_FLOAT || value < -INT64_MAX_FLOAT) {
        logger?.debug(`Span attribute ${value} is outside the int64 range; encoding it as a string`)
        // Via BigInt for the double's exact decimal value: `String(2**64)` gives
        // the shortest round-tripping form ("18446744073709552000"), not the
        // number the caller actually holds.
        return { stringValue: exactIntegerString(value) }
      }
      return { intValue: String(value) }
    }
    return { doubleValue: value }
  }
  if (typeof value === 'string') {
    return { stringValue: value }
  }
  if (value instanceof Date) {
    // Before the object branch: a Date has no own enumerable keys, so it would
    // otherwise encode as an empty kvlist and lose the value silently.
    const time = value.getTime()
    return { stringValue: Number.isFinite(time) ? value.toISOString() : String(value) }
  }
  if (typeof value === 'object' && value !== null) {
    const path = seen ?? new WeakSet<object>()
    if (path.has(value)) {
      return { stringValue: CIRCULAR_MARKER }
    }
    path.add(value)
    try {
      if (isArray(value)) {
        // A null inside an array becomes an empty AnyValue rather than being
        // skipped, so positions line up with what the caller passed.
        return { arrayValue: { values: value.map((v) => (isNullish(v) ? {} : toOtlpAnyValue(v, logger, path))) } }
      }
      return { kvlistValue: { values: toOtlpKeyValueList(value as SpanAttributes, logger, path) } }
    } finally {
      // Siblings that reference the same object are duplication, not a cycle.
      path.delete(value)
    }
  }
  return { stringValue: String(value) }
}

export function toOtlpKeyValueList(
  attributes: SpanAttributes,
  logger?: Logger,
  seen?: WeakSet<object>
): OtlpSpanKeyValue[] {
  const result: OtlpSpanKeyValue[] = []
  for (const key in attributes) {
    const value = attributes[key]
    if (isNullish(value)) {
      continue
    }
    result.push({ key, value: toOtlpAnyValue(value, logger, seen) })
  }
  return result
}

// ============================================================================
// Span and envelope construction
// ============================================================================

function toOtlpEvent(event: SpanRecord['events'][number], logger?: Logger): OtlpSpanEvent {
  const encoded: OtlpSpanEvent = {
    name: event.name,
    timeUnixNano: msToUnixNanoString(event.timestamp),
  }
  if (event.attributes) {
    const attributes = toOtlpKeyValueList(event.attributes, logger)
    if (attributes.length) {
      encoded.attributes = attributes
    }
  }
  return encoded
}

export function buildOtlpSpan(record: SpanRecord, logger?: Logger): OtlpSpan {
  const span: OtlpSpan = {
    traceId: record.traceId,
    spanId: record.spanId,
    name: record.name,
    kind: spanKindToOtlp(record.kind),
    startTimeUnixNano: msToUnixNanoString(record.startTime),
    endTimeUnixNano: msToUnixNanoString(record.endTime),
    flags: TRACE_FLAGS_SAMPLED,
  }
  if (record.parentSpanId) {
    span.parentSpanId = record.parentSpanId
  }
  if (record.traceState) {
    span.traceState = record.traceState
  }
  const attributes = toOtlpKeyValueList(record.attributes, logger)
  if (attributes.length) {
    span.attributes = attributes
  }
  if (record.events.length) {
    span.events = record.events.map((event) => toOtlpEvent(event, logger))
  }
  // An unset status is omitted rather than sent as code 0 — the server treats
  // both the same, and omitting keeps the payload honest about "never set".
  if (record.status) {
    span.status = {
      code: SPAN_STATUS_TO_OTLP[record.status.code],
      ...(record.status.message && { message: record.status.message }),
    }
  }
  return span
}

/**
 * OTLP resource attributes for every batch.
 *
 * User `resourceAttributes` are spread first, then SDK-controlled identity keys
 * on top so a stray key can't clobber them. `service.name` is always emitted:
 * the server reads `service_name` only from that attribute and stores an empty
 * string when it's missing, leaving spans unattributable in the product.
 */
export function buildTracesResourceAttributes(
  config: ResolvedTracesConfig,
  sdkName: string,
  sdkVersion: string
): SpanAttributes {
  return {
    ...config.resourceAttributes,
    'service.name': config.serviceName || 'unknown_service',
    ...(config.environment && { 'deployment.environment': config.environment }),
    ...(config.serviceVersion && { 'service.version': config.serviceVersion }),
    'telemetry.sdk.name': sdkName,
    'telemetry.sdk.version': sdkVersion,
  }
}

/**
 * Wraps spans in the OTLP `resourceSpans` envelope: one resource, one scope, N
 * spans per batch. The server flattens the scope to `{name}@{version}`.
 */
export function buildOtlpTracesPayload(
  spans: OtlpSpan[],
  resourceAttributes: SpanAttributes,
  scopeName: string,
  scopeVersion: string,
  logger?: Logger
): OtlpTracesPayload {
  return {
    resourceSpans: [
      {
        resource: { attributes: toOtlpKeyValueList(resourceAttributes, logger) },
        scopeSpans: [
          {
            scope: { name: scopeName, version: scopeVersion },
            spans,
          },
        ],
      },
    ],
  }
}
