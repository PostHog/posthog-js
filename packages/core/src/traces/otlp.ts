// OTLP encoding for spans.
//
// Attribute values go through the shared `AnyValue` encoder, which is what the
// logs and metrics senders use: the wire shape is the same for all three, and
// the guards that keep a single bad value from 400ing an entire batch are worth
// having in one place.

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
import { toOtlpKeyValueList } from '../utils/otlp-any-value'

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
