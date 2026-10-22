import type { Attributes } from '@opentelemetry/api'
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base'

const AI_SPAN_PREFIXES = ['gen_ai.', 'llm.', 'ai.', 'traceloop.'] as const

/**
 * Returns `true` when the span is AI-related — its name or any attribute
 * key starts with `gen_ai.`, `llm.`, `ai.`, or `traceloop.`.
 */
export function isAISpan(span: ReadableSpan): boolean {
  if (AI_SPAN_PREFIXES.some((prefix) => span.name.startsWith(prefix))) {
    return true
  }
  const attributes = span.attributes
  if (attributes) {
    return Object.keys(attributes).some((key) => AI_SPAN_PREFIXES.some((prefix) => key.startsWith(prefix)))
  }
  return false
}

/** Copies rather than mutates: the span is shared across every registered processor/exporter. */
export function withAttributes(span: ReadableSpan, attributes: Attributes, events?: TimedEvent[]): ReadableSpan {
  return Object.create(span, {
    attributes: { value: attributes, enumerable: true, configurable: true },
    ...(events ? { events: { value: events, enumerable: true, configurable: true } } : {}),
  })
}
