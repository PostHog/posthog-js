import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { ExportResultCode } from '@opentelemetry/core'

import { isAISpan } from './spans'

export interface PostHogTraceExporterOptions {
  /**
   * Your PostHog project API key.
   */
  apiKey: string

  /**
   * PostHog host URL. Defaults to `https://us.i.posthog.com`.
   */
  host?: string
}

/**
 * An OpenTelemetry `TraceExporter` that sends AI traces to PostHog's OTLP
 * ingestion endpoint. PostHog converts `gen_ai.*` spans into
 * `$ai_generation` events server-side.
 *
 * Only AI-related spans (those whose name or attribute keys start with
 * `gen_ai.`, `llm.`, `ai.`, or `traceloop.`) are exported; all other
 * spans are silently dropped.
 *
 * Use this when the API you're integrating with only accepts a
 * `TraceExporter` (e.g. Vercel's `registerOTel`) or when you need to
 * plug PostHog into an existing processor chain. Otherwise prefer
 * {@link PostHogSpanProcessor}, which is self-contained.
 *
 * @example
 * ```ts
 * import { PostHogTraceExporter } from '@posthog/ai/otel'
 * import { registerOTel } from '@vercel/otel'
 *
 * registerOTel({
 *   serviceName: 'my-app',
 *   traceExporter: new PostHogTraceExporter({ apiKey: 'phc_...' }),
 * })
 * ```
 */
export class PostHogTraceExporter {
  private readonly inner: OTLPTraceExporter

  constructor(options: PostHogTraceExporterOptions) {
    if (!options.apiKey) {
      throw new Error('PostHogTraceExporter requires an apiKey')
    }
    const host = new URL(options.host || 'https://us.i.posthog.com').origin
    this.inner = new OTLPTraceExporter({
      url: `${host}/i/v0/ai/otel`,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
      },
    })
  }

  export(spans: ReadableSpan[], resultCallback: (result: { code: number; error?: Error }) => void): void {
    const aiSpans = spans.filter(isAISpan)
    if (aiSpans.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS })
      return
    }
    this.inner.export(aiSpans, resultCallback)
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush()
  }
}
