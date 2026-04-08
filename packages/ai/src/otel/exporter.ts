import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

import { isAISpan } from './spans'

// ExportResultCode.SUCCESS from @opentelemetry/core, inlined to avoid adding
// a direct dependency on @opentelemetry/core.
const EXPORT_SUCCESS = 0

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
export class PostHogTraceExporter extends OTLPTraceExporter {
  constructor(options: PostHogTraceExporterOptions) {
    if (!options.apiKey) {
      throw new Error('PostHogTraceExporter requires an apiKey')
    }
    const host = new URL(options.host || 'https://us.i.posthog.com').origin
    super({
      url: `${host}/i/v0/ai/otel`,
      headers: {
        // The OTLP ingestion endpoint authenticates using the project API key as a Bearer token
        Authorization: `Bearer ${options.apiKey}`,
      },
    })

    // Wrap the inherited export method to filter to AI spans only.
    // We access via the prototype rather than using `override` / `super.export()`
    // because the parent's ExportResult type lives in @opentelemetry/core which
    // isn't a direct dependency, and the dts plugin can't resolve it.
    const parentExport = OTLPTraceExporter.prototype.export
    const self = this
    this.export = function (
      spans: ReadableSpan[],
      resultCallback: (result: { code: number; error?: Error }) => void
    ): void {
      const aiSpans = spans.filter(isAISpan)
      if (aiSpans.length === 0) {
        resultCallback({ code: EXPORT_SUCCESS })
        return
      }
      parentExport.call(self, aiSpans, resultCallback)
    }
  }
}
