import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

import { EXPORT_SUCCESS, OtlpFetchTraceExporter, type ExportResult } from './otlpFetchExporter'
import { redactSpan } from './redact'
import { isAISpan } from './spans'
import { resolveOtlpTarget, type PostHogOtlpOptions } from './target'
import { warnIfPostHogAiGatewayOtelAttributes } from '../gatewayWarning'

// Intentionally reports success: missing or blank tokens disable exporting as a
// compatibility no-op. Reporting failure would make OpenTelemetry treat every
// span as an export error.
const NOOP_EXPORTER: SpanExporter = {
  export: (_spans, resultCallback) => resultCallback({ code: EXPORT_SUCCESS }),
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
}

/**
 * Options for the PostHogTraceExporter. `projectToken` is required; a blank token disables the
 * exporter as a defensive no-op. You can also optionally override the `host` URL. `host` defaults to `https://us.i.posthog.com`.
 *
 * @example
 * ```ts
 * import { PostHogTraceExporter } from '@posthog/ai/otel'
 *
 * new PostHogTraceExporter({ projectToken: 'phc_...' })
 * ```
 *
 * @example
 * ```ts
 * import { PostHogTraceExporter } from '@posthog/ai/otel'
 *
 * new PostHogTraceExporter({ projectToken: 'phc_...', host: 'https://eu.i.posthog.com' })
 * ```
 */
export type PostHogTraceExporterOptions = PostHogOtlpOptions

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
 * `projectToken` is required; a blank token disables the exporter as a defensive no-op.
 * You can also optionally override the `host` URL.
 *
 * @example
 * ```ts
 * import { PostHogTraceExporter } from '@posthog/ai/otel'
 * import { registerOTel } from '@vercel/otel'
 *
 * registerOTel({
 *   serviceName: 'my-app',
 *   traceExporter: new PostHogTraceExporter({ projectToken: 'phc_...' }),
 * })
 * ```
 */
export class PostHogTraceExporter implements SpanExporter {
  private readonly inner: SpanExporter

  constructor(options: PostHogTraceExporterOptions) {
    const target = resolveOtlpTarget(options)
    if (!target) {
      console.warn('[PostHogTraceExporter] projectToken is missing or blank; the exporter will be disabled.')
      this.inner = NOOP_EXPORTER
      return
    }
    this.inner = new OtlpFetchTraceExporter(target)
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const aiSpans = spans.filter(isAISpan)
    if (aiSpans.length === 0) {
      resultCallback({ code: EXPORT_SUCCESS })
      return
    }
    for (const span of aiSpans) {
      warnIfPostHogAiGatewayOtelAttributes(span.attributes)
    }
    this.inner.export(aiSpans.map(redactSpan), resultCallback)
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve()
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }
}
