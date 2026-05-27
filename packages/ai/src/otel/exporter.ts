import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { ExportResultCode } from '@opentelemetry/core'

import { isAISpan } from './spans'

const DEFAULT_OTEL_HOST = 'https://us.i.posthog.com'

function normalizeToken(value?: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeHost(value?: unknown): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  return normalizedValue || DEFAULT_OTEL_HOST
}

export interface PostHogTraceExporterOptions {
  /**
   * Your PostHog project API token.
   */
  token?: string

  /**
   * Your PostHog project API key.
   *
   * @deprecated Use `token` instead
   */
  apiKey?: string

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
 *   traceExporter: new PostHogTraceExporter({ token: 'phc_...' }),
 * })
 * ```
 */
export class PostHogTraceExporter extends OTLPTraceExporter {
  constructor(options: PostHogTraceExporterOptions) {
    const token = normalizeToken(options.token || options.apiKey)
    if (!token) {
      throw new Error('PostHogTraceExporter requires a token')
    }

    const host = new URL(normalizeHost(options.host)).origin
    super({
      url: `${host}/i/v0/ai/otel`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
  }

  override export(spans: ReadableSpan[], resultCallback: (result: { code: number; error?: Error }) => void): void {
    const aiSpans = spans.filter(isAISpan)
    if (aiSpans.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS })
      return
    }
    super.export(aiSpans, resultCallback)
  }
}
