import type {
  OtlpSpan,
  OtlpSpanEvent,
  OtlpSpanKeyValue,
  OtlpTracesPayload,
  SpanAttributes,
  SpanKind,
  SpanStatusCode,
} from '@posthog/types'
import type { Logger } from '../types'
import type { ResolvedTracesConfig, SpanRecord } from './types'
import { nonNegativeCount } from './span'
import { toOtlpKeyValueList } from '../utils/otlp-any-value'
import { UNSERIALIZABLE_VALUE, sanitizeString } from '../utils/json-utils'
import { buildOtlpResourceAttributes } from '../utils/otlp-resource'

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

/** W3C trace flags: the sampled bit, always set because every captured span is recorded. */
const TRACE_FLAGS_SAMPLED = 1

/**
 * Every free-text string this encoder puts on the wire. A lone surrogate survives
 * `JSON.stringify` as a `\uD800` escape that strict parsers refuse, and the
 * ingestion service refuses the whole request rather than the one row — so the
 * safe path has to be the default, not the exception.
 */
function wireString(value: unknown): string {
  if (typeof value === 'string') {
    return sanitizeString(value)
  }
  try {
    return sanitizeString(String(value))
  } catch {
    // A hostile `toString` costs its own field, not the whole span.
    return UNSERIALIZABLE_VALUE
  }
}

export function spanKindToOtlp(kind: SpanKind | undefined): number {
  // `hasOwnProperty`, not a plain lookup: `kind: '__proto__'` from an untyped
  // caller otherwise resolves to `Object.prototype` and ships `"kind":{}`.
  if (kind && Object.prototype.hasOwnProperty.call(SPAN_KIND_TO_OTLP, kind)) {
    return SPAN_KIND_TO_OTLP[kind]
  }
  return SPAN_KIND_TO_OTLP.internal
}

/**
 * Converts a millisecond epoch to the unix-nanosecond string OTLP expects.
 * Concatenation rather than multiplication: `Date.now() * 1e6` exceeds
 * `Number.MAX_SAFE_INTEGER`.
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

function toOtlpEvent(event: SpanRecord['events'][number], logger?: Logger): OtlpSpanEvent {
  const encoded: OtlpSpanEvent = {
    name: wireString(event.name),
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
    name: wireString(record.name),
    kind: spanKindToOtlp(record.kind),
    startTimeUnixNano: msToUnixNanoString(record.startTime),
    endTimeUnixNano: msToUnixNanoString(record.endTime),
    flags: TRACE_FLAGS_SAMPLED,
  }
  if (record.parentSpanId) {
    span.parentSpanId = record.parentSpanId
  }
  if (record.traceState) {
    span.traceState = wireString(record.traceState)
  }
  const attributes = toOtlpKeyValueList(record.attributes, logger)
  if (attributes.length) {
    span.attributes = attributes
  }
  if (record.events.length) {
    span.events = record.events.map((event) => toOtlpEvent(event, logger))
  }
  // Coerced: a `beforeSpanSend` hook can write anything onto the record, and a
  // non-integer here is refused for the whole request.
  const droppedAttributes = nonNegativeCount(record.droppedAttributesCount)
  if (droppedAttributes) {
    span.droppedAttributesCount = droppedAttributes
  }
  const droppedEvents = nonNegativeCount(record.droppedEventsCount)
  if (droppedEvents) {
    span.droppedEventsCount = droppedEvents
  }
  if (record.status) {
    span.status = {
      code: SPAN_STATUS_TO_OTLP[record.status.code],
      ...(record.status.message && { message: wireString(record.status.message) }),
    }
  }
  return span
}

/**
 * OTLP resource attributes for every batch. User `resourceAttributes` are spread
 * first, then SDK-controlled identity keys on top so a stray key can't clobber
 * them. `service.name` is always emitted: the server reads `service_name` only
 * from that attribute, and spans are unattributable without it.
 */
export function buildTracesResourceAttributes(
  config: ResolvedTracesConfig,
  sdkName: string,
  sdkVersion: string
): SpanAttributes {
  return buildOtlpResourceAttributes(config, sdkName, sdkVersion)
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
