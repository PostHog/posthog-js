import type { Attributes, AttributeValue, SpanStatus } from '@opentelemetry/api'
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base'

// Low 8 bits carry the W3C trace flags; the next two bits record whether the
// remote flag is known and whether it is set. Matches the OTLP span flags spec.
const SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE_MASK = 0x100
const SPAN_FLAGS_CONTEXT_IS_REMOTE_MASK = 0x200

const NANOSECONDS_PER_SECOND = BigInt(1_000_000_000)

type AnyValue = Record<string, unknown>
type KeyValue = { key: string; value: AnyValue }
// `attributes` reached InstrumentationScope after the typings this peer range pins.
type Scope = NonNullable<ReadableSpan['instrumentationScope']> & {
  attributes?: Attributes
  droppedAttributesCount?: number
}

function toAnyValue(value: unknown): AnyValue {
  const type = typeof value
  if (type === 'string') {
    return { stringValue: value }
  }
  if (type === 'number') {
    return Number.isInteger(value) ? { intValue: value } : { doubleValue: value }
  }
  if (type === 'boolean') {
    return { boolValue: value }
  }
  if (value instanceof Uint8Array) {
    return { bytesValue: toBase64(value) }
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toAnyValue) } }
  }
  if (type === 'object' && value !== null) {
    return { kvlistValue: { values: toAttributes(value as Record<string, AttributeValue>) } }
  }
  return {}
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  // Avoid spreading into btoa, which overflows the stack on large arrays.
  const chars = new Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    chars[i] = String.fromCharCode(bytes[i])
  }
  return btoa(chars.join(''))
}

function toAttributes(attributes: Attributes | undefined): KeyValue[] {
  if (!attributes) {
    return []
  }
  return Object.keys(attributes).map((key) => ({ key, value: toAnyValue(attributes[key]) }))
}

function encodeHrTime(hrTime: [number, number] | undefined): string {
  if (!hrTime) {
    return '0'
  }
  const nanos = BigInt(Math.trunc(hrTime[0])) * NANOSECONDS_PER_SECOND + BigInt(Math.trunc(hrTime[1]))
  return nanos.toString()
}

function spanFlags(traceFlags: number | undefined, isRemote: boolean | undefined): number {
  let flags = ((traceFlags ?? 0) & 0xff) | SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE_MASK
  if (isRemote) {
    flags |= SPAN_FLAGS_CONTEXT_IS_REMOTE_MASK
  }
  return flags
}

function toEvent(event: TimedEvent): Record<string, unknown> {
  return {
    attributes: toAttributes(event.attributes),
    name: event.name,
    timeUnixNano: encodeHrTime(event.time),
    droppedAttributesCount: event.droppedAttributesCount ?? 0,
  }
}

function toLink(link: ReadableSpan['links'][number]): Record<string, unknown> {
  return {
    attributes: toAttributes(link.attributes),
    spanId: link.context.spanId,
    traceId: link.context.traceId,
    traceState: link.context.traceState?.serialize(),
    droppedAttributesCount: link.droppedAttributesCount ?? 0,
    flags: spanFlags(link.context.traceFlags, link.context.isRemote),
  }
}

function toSpan(span: ReadableSpan): Record<string, unknown> {
  const context = span.spanContext()
  const status: SpanStatus = span.status ?? { code: 0 }
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    traceState: context.traceState?.serialize(),
    name: span.name,
    // The API leaves 0 unset, so every kind is offset by one on the wire.
    kind: span.kind == null ? 0 : span.kind + 1,
    startTimeUnixNano: encodeHrTime(span.startTime),
    endTimeUnixNano: encodeHrTime(span.endTime),
    attributes: toAttributes(span.attributes),
    droppedAttributesCount: span.droppedAttributesCount ?? 0,
    events: (span.events ?? []).map(toEvent),
    droppedEventsCount: span.droppedEventsCount ?? 0,
    status: { code: status.code, message: status.message },
    links: (span.links ?? []).map(toLink),
    droppedLinksCount: span.droppedLinksCount ?? 0,
    flags: spanFlags(context.traceFlags, span.parentSpanContext?.isRemote),
  }
}

function toScopeSpans(group: ReadableSpan[]): Record<string, unknown> {
  const scope = group[0].instrumentationScope as Scope | undefined
  const attributes = toAttributes(scope?.attributes)
  return {
    scope: {
      name: scope?.name,
      version: scope?.version,
      ...(attributes.length ? { attributes, droppedAttributesCount: scope?.droppedAttributesCount ?? 0 } : {}),
    },
    spans: group.map(toSpan),
    schemaUrl: scope?.schemaUrl,
  }
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key)
  if (value === undefined) {
    value = create()
    map.set(key, value)
  }
  return value
}

/**
 * Serializes spans into an OTLP/JSON `ExportTraceServiceRequest` body.
 *
 * Written here rather than taken from `@opentelemetry/otlp-transformer` because
 * that package depends on `@opentelemetry/core`, and `tests/otel-module-load.cjs`
 * asserts the published `./otel` subpath loads without it. Replacing only the
 * transport was the alternative, and it would have reintroduced that dependency.
 * The tests in `tests/otlpJson.test.ts` pin this output to the upstream
 * serializer's, byte for byte.
 */
export function serializeTraceRequest(spans: ReadableSpan[]): string {
  const byResource = new Map<ReadableSpan['resource'] | undefined, Map<string, ReadableSpan[]>>()
  for (const span of spans) {
    const byScope = getOrCreate(byResource, span.resource, () => new Map<string, ReadableSpan[]>())
    const scope = span.instrumentationScope
    const scopeKey = `${scope?.name ?? ''}@${scope?.version ?? ''}:${scope?.schemaUrl ?? ''}`
    getOrCreate(byScope, scopeKey, () => []).push(span)
  }

  const resourceSpans = Array.from(byResource, ([resource, byScope]) => {
    const schemaUrl = resource?.schemaUrl || undefined
    return {
      resource: { attributes: toAttributes(resource?.attributes), droppedAttributesCount: 0, schemaUrl },
      scopeSpans: Array.from(byScope.values(), toScopeSpans),
      schemaUrl,
    }
  })

  return JSON.stringify({ resourceSpans })
}
