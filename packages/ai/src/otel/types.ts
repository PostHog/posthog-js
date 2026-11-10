import type { Context, Span as APISpan } from '@opentelemetry/api'
import type { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

// Use the span types belonging to the installed exporter, whether it uses OTel 2.x or 3.x.
export type ReadableSpan = Parameters<OTLPTraceExporter['export']>[0][number]
export type TimedEvent = ReadableSpan['events'][number]
export type Span = APISpan & ReadableSpan

export interface SpanProcessor {
  onStart(span: Span, parentContext: Context): void
  onEnd(span: ReadableSpan): void
  forceFlush(): Promise<void>
  shutdown(): Promise<void>
}
