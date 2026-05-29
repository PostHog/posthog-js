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

/**
 * Options for the PostHogTraceExporter. You must obligatorily provide `projectToken`. You can also
 * optionally override the `host` URL. `host` defaults to `https://us.i.posthog.com`.
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
export type PostHogTraceExporterOptions =
  | { projectToken: string; apiKey?: never; host?: string }
  | {
      /** @deprecated Use `projectToken` instead */
      apiKey: string
      projectToken?: never
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
 * You must obligatorily provide `projectToken`. You can also
 * optionally override the `host` URL.
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
export class PostHogTraceExporter extends OTLPTraceExporter {
  constructor(options: PostHogTraceExporterOptions) {
    const token = 'projectToken' in options ? normalizeToken(options.projectToken) : normalizeToken(options.apiKey)
    if (!token) {
      throw new Error('PostHogTraceExporter requires a projectToken')
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
