import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { Context } from '@opentelemetry/api'
import { BatchSpanProcessor, type SpanProcessor, type ReadableSpan, type Span } from '@opentelemetry/sdk-trace-base'

import { isAISpan } from './spans'

const DEFAULT_OTEL_HOST = 'https://us.i.posthog.com'

function normalizeApiKey(value: string): string {
  return value.trim()
}

function normalizeHost(value?: string): string {
  return value?.trim() || DEFAULT_OTEL_HOST
}

export interface PostHogSpanProcessorOptions {
  /**
   * Your PostHog project API key.
   */
  apiKey: string

  /**
   * PostHog host URL. Defaults to `https://us.i.posthog.com`.
   */
  host?: string

  /**
   * @internal Injected processor for testing — bypasses exporter creation.
   */
  _spanProcessor?: SpanProcessor
}

/**
 * An OpenTelemetry `SpanProcessor` that sends AI traces to PostHog.
 *
 * Internally batches spans and exports them to PostHog's OTLP ingestion
 * endpoint. Only AI-related spans (those whose name or attribute keys
 * start with `gen_ai.`, `llm.`, `ai.`, or `traceloop.`) are exported;
 * all other spans are silently dropped.
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
 * const sdk = new NodeSDK({
 *   spanProcessors: [new PostHogSpanProcessor({ apiKey: 'phc_...' })],
 * })
 * sdk.start()
 * ```
 */
export class PostHogSpanProcessor implements SpanProcessor {
  private readonly inner: SpanProcessor

  constructor(options: PostHogSpanProcessorOptions) {
    const apiKey = normalizeApiKey(options.apiKey)
    if (!apiKey) {
      throw new Error('PostHogSpanProcessor requires an apiKey')
    }

    if (options._spanProcessor) {
      this.inner = options._spanProcessor
    } else {
      const host = new URL(normalizeHost(options.host)).origin
      const exporter = new OTLPTraceExporter({
        url: `${host}/i/v0/ai/otel`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })
      this.inner = new BatchSpanProcessor(exporter)
    }
  }

  onStart(span: Span, parentContext: Context): void {
    // Forwarded unconditionally — filtering happens in onEnd. We can't filter
    // here because the span hasn't finished yet and may not have AI attributes
    // set. BatchSpanProcessor.onStart is a no-op so this is safe.
    this.inner.onStart(span, parentContext)
  }

  onEnd(span: ReadableSpan): void {
    if (isAISpan(span)) {
      this.inner.onEnd(span)
    }
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush()
  }
}
