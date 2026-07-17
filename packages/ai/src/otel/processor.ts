import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { Context } from '@opentelemetry/api'
import { BatchSpanProcessor, type SpanProcessor, type ReadableSpan, type Span } from '@opentelemetry/sdk-trace-base'

import { redactSpan } from './redact'
import { isAISpan } from './spans'
import { warnIfPostHogAiGatewayOtelAttributes } from '../gatewayWarning'

const DEFAULT_OTEL_HOST = 'https://us.i.posthog.com'
const DEFAULT_AI_GATEWAY_HOST = 'https://ai-gateway.us.posthog.com'

function normalizeToken(value?: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeHost(value: unknown, defaultHost: string): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  return normalizedValue || defaultHost
}

interface PostHogSpanProcessorBaseOptions {
  /**
   * PostHog host URL. Defaults to `https://us.i.posthog.com` for project tokens
   * and `https://ai-gateway.us.posthog.com` for project secrets.
   */
  host?: string

  /**
   * @internal Injected processor for testing — bypasses exporter creation.
   */
  _spanProcessor?: SpanProcessor
}

export type PostHogSpanProcessorOptions = PostHogSpanProcessorBaseOptions &
  (
    | {
        /** Your PostHog project token (the `phc_...` key). */
        projectToken: string
        projectSecret?: never
      }
    | {
        /** Your AI gateway project secret (the `phs_...` key). */
        projectSecret: string
        projectToken?: never
      }
  )

interface PostHogSpanProcessorRuntimeOptions extends PostHogSpanProcessorBaseOptions {
  /**
   * Your PostHog project token (the `phc_...` key).
   */
  projectToken?: string
  /** Your AI gateway project secret (the `phs_...` key). */
  projectSecret?: string
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
 * Provide either a `projectToken` for direct PostHog ingestion or a
 * `projectSecret` for AI gateway ingestion. A blank credential disables the
 * processor as a defensive no-op.
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
 *   spanProcessors: [new PostHogSpanProcessor({ projectToken: 'phc_...' })],
 * })
 * sdk.start()
 * ```
 */
export class PostHogSpanProcessor implements SpanProcessor {
  private readonly inner: SpanProcessor

  constructor(options: PostHogSpanProcessorOptions) {
    const runtimeOptions = options as PostHogSpanProcessorRuntimeOptions
    const projectToken = normalizeToken(runtimeOptions.projectToken)
    const projectSecret = normalizeToken(runtimeOptions.projectSecret)
    const token = projectSecret || projectToken
    if (!token) {
      console.warn(
        '[PostHogSpanProcessor] projectToken or projectSecret is missing or blank; the processor will be disabled.'
      )
      this.inner = new NoopSpanProcessor()
      return
    }
    if (projectToken && projectSecret) {
      throw new TypeError('[PostHogSpanProcessor] provide either projectToken or projectSecret, not both.')
    }

    if (runtimeOptions._spanProcessor) {
      this.inner = runtimeOptions._spanProcessor
    } else {
      const defaultHost = projectSecret ? DEFAULT_AI_GATEWAY_HOST : DEFAULT_OTEL_HOST
      const host = new URL(normalizeHost(runtimeOptions.host, defaultHost)).origin
      const exporter = new OTLPTraceExporter({
        url: `${host}/i/v0/ai/otel`,
        headers: {
          Authorization: `Bearer ${token}`,
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
