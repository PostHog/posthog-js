import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

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
 * An OpenTelemetry SpanExporter that sends traces to PostHog's OTLP
 * ingestion endpoint. PostHog converts `gen_ai.*` spans into
 * `$ai_generation` events server-side.
 *
 * @example
 * ```ts
 * import { PostHogTraceExporter } from '@posthog/ai/otel'
 * import { NodeSDK } from '@opentelemetry/sdk-node'
 *
 * const sdk = new NodeSDK({
 *   traceExporter: new PostHogTraceExporter({ apiKey: 'phc_...' }),
 * })
 * sdk.start()
 * ```
 */
export class PostHogTraceExporter extends OTLPTraceExporter {
  constructor(options: PostHogTraceExporterOptions) {
    const host = new URL(options.host || 'https://us.i.posthog.com').origin
    super({
      url: `${host}/i/v0/ai/otel`,
      headers: {
        // The OTLP ingestion endpoint authenticates using the project API key as a Bearer token
        Authorization: `Bearer ${options.apiKey}`,
      },
    })
  }
}
