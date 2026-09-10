import type { Context } from '@opentelemetry/api'
import { BatchSpanProcessor, type SpanProcessor, type ReadableSpan, type Span } from '@opentelemetry/sdk-trace-base'

import { OtlpFetchTraceExporter } from './otlpFetchExporter'
import { redactSpan } from './redact'
import { isAISpan } from './spans'
import { resolveOtlpTarget, type PostHogOtlpOptions } from './target'
import { warnIfPostHogAiGatewayOtelAttributes } from '../gatewayWarning'

export interface PostHogSpanProcessorOptions extends PostHogOtlpOptions {
  /**
   * @internal Injected processor for testing — bypasses exporter creation.
   */
  _spanProcessor?: SpanProcessor
}

class NoopSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {
    return
  }
  onEnd(_span: ReadableSpan): void {
    return
  }
  shutdown(): Promise<void> {
    return Promise.resolve()
  }
  forceFlush(): Promise<void> {
    return Promise.resolve()
  }
}

/**
 * An OpenTelemetry `SpanProcessor` that sends AI traces to PostHog.
 *
 * `projectToken` is required; a blank token disables the processor as a defensive no-op.
 *
 * Internally batches spans and exports them to PostHog's OTLP ingestion
 * endpoint. Only AI-related spans (those whose name or attribute keys
 * start with `gen_ai.`, `llm.`, `ai.`, or `traceloop.`) are exported;
 * all other spans are silently dropped.
 *
 * Request-scoped and serverless runtimes should keep a reference to this
 * processor and await {@link PostHogSpanProcessor.forceFlush} before the request
 * lifecycle ends. This waits for queued exports without sending one request per span.
 *
 * This is the recommended integration point when your setup accepts a
 * `SpanProcessor`. If you need a `TraceExporter` instead (e.g. for
 * Vercel's `registerOTel`), use {@link PostHogTraceExporter}.
 *
 * @example
 * ```ts
 * import { PostHogSpanProcessor } from '@posthog/ai/otel'
 * import { NodeSDK } from '@opentelemetry/sdk-node'
 *
 * const processor = new PostHogSpanProcessor({ projectToken: 'phc_...' })
 * const sdk = new NodeSDK({ spanProcessors: [processor] })
 * sdk.start()
 *
 * // In request-scoped runtimes, wait for queued exports before returning.
 * await processor.forceFlush()
 * ```
 */
export class PostHogSpanProcessor implements SpanProcessor {
  private readonly inner: SpanProcessor

  constructor(options: PostHogSpanProcessorOptions) {
    const target = resolveOtlpTarget(options)
    if (!target) {
      console.warn('[PostHogSpanProcessor] projectToken is missing or blank; the processor will be disabled.')
      this.inner = new NoopSpanProcessor()
      return
    }
    this.inner = options._spanProcessor ?? new BatchSpanProcessor(new OtlpFetchTraceExporter(target))
  }

  onStart(span: Span, parentContext: Context): void {
    // Forwarded unconditionally — filtering happens in onEnd. We can't filter
    // here because the span hasn't finished yet and may not have AI attributes
    // set. BatchSpanProcessor.onStart is a no-op so this is safe.
    this.inner.onStart(span, parentContext)
  }

  onEnd(span: ReadableSpan): void {
    if (isAISpan(span)) {
      warnIfPostHogAiGatewayOtelAttributes(span.attributes)
      this.inner.onEnd(redactSpan(span))
    }
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush()
  }
}
