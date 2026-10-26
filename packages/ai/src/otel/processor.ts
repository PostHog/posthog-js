import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { Context } from '@opentelemetry/api'
import type { SpanExporter, SpanProcessor, ReadableSpan, Span } from '@opentelemetry/sdk-trace-base'

import { redactSpan } from './redact'
import { stripContent } from './privacy'
import { isPrivacyModeEnabled, type PrivacyModeGate } from '../privacyMode'
import { captureContext, withRequestContext, type CapturedContext, type PostHogContextSource } from './requestContext'
import { isAISpan } from './spans'
import { warnIfPostHogAiGatewayOtelAttributes } from '../gatewayWarning'

const DEFAULT_OTEL_HOST = 'https://us.i.posthog.com'
// OpenTelemetry's ExportResultCode.SUCCESS is 0.
const EXPORT_SUCCESS = 0
// The same defaults as OpenTelemetry's BatchSpanProcessor.
const MAX_QUEUE_SIZE = 2048
const MAX_EXPORT_BATCH_SIZE = 512
const SCHEDULED_DELAY_MS = 5000
const EXPORT_TIMEOUT_MS = 30000

function normalizeToken(value?: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeHost(value?: unknown): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  return normalizedValue || DEFAULT_OTEL_HOST
}

export interface PostHogSpanProcessorOptions {
  /**
   * Your PostHog project token (the `phc_...` key). Required; a blank token disables the
   * processor as a defensive no-op.
   */
  projectToken: string

  /**
   * PostHog host URL. Defaults to `https://us.i.posthog.com`.
   */
  host?: string

  /**
   * Your posthog-node client. When set, each AI span this processor exports gets the distinct ID,
   * session ID (as `$session_id`) and properties from the context entered with `client.withContext()` or
   * `client.enterContext()`. Other processors on the provider don't see them.
   * Attributes already on the span win over properties, which win over the context's IDs.
   * The context is captured when a span starts, but its properties are read when the span ends,
   * so mutating a context object while a span is open shows up in the export.
   * Must be the same posthog-node instance you call `withContext` or `enterContext` on.
   */
  client?: PostHogContextSource & PrivacyModeGate

  /**
   * Drop prompts, outputs, tool arguments and results, and error messages from exported spans.
   * Also on when the `client` was created with `privacyMode: true`. Defaults to false.
   */
  privacyMode?: boolean

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
 * Queues spans and exports them in batches. It replaces OpenTelemetry's BatchSpanProcessor,
 * because `@opentelemetry/sdk-trace-base` does not exist in OpenTelemetry JS 3.x.
 */
class BatchingSpanProcessor implements SpanProcessor {
  private queue: ReadableSpan[] = []
  private timer?: ReturnType<typeof setTimeout>
  private readonly pendingExports = new Set<Promise<void>>()
  private shutdownPromise?: Promise<void>

  constructor(private readonly exporter: SpanExporter) {}

  onStart(_span: Span, _parentContext: Context): void {
    return
  }

  onEnd(span: ReadableSpan): void {
    if (this.shutdownPromise || this.queue.length >= MAX_QUEUE_SIZE) {
      return
    }
    this.queue.push(span)
    if (this.queue.length >= MAX_EXPORT_BATCH_SIZE) {
      this.exportQueued().catch(() => {})
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.exportQueued().catch(() => {})
      }, SCHEDULED_DELAY_MS)
      this.timer.unref?.()
    }
  }

  forceFlush(): Promise<void> {
    return this.exportQueued()
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.exportQueued().finally(() => this.exporter.shutdown())
    return this.shutdownPromise
  }

  private exportQueued(): Promise<void> {
    clearTimeout(this.timer)
    this.timer = undefined
    while (this.queue.length > 0) {
      this.track(this.exportBatch(this.queue.splice(0, MAX_EXPORT_BATCH_SIZE)))
    }
    return Promise.all(this.pendingExports).then(() => undefined)
  }

  private track(exported: Promise<void>): void {
    this.pendingExports.add(exported)
    const untrack = (): void => {
      this.pendingExports.delete(exported)
    }
    exported.then(untrack, untrack)
  }

  private exportBatch(spans: ReadableSpan[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), EXPORT_TIMEOUT_MS)
      timeout.unref?.()
      this.exporter.export(spans, (result) => {
        clearTimeout(timeout)
        if (result.code === EXPORT_SUCCESS) {
          resolve()
        } else {
          reject(result.error ?? new Error('BatchingSpanProcessor: span export failed'))
        }
      })
    })
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
 *
 * @example
 * ```ts
 * // Per request: pass your posthog-node client, then wrap the work in a context.
 * const processor = new PostHogSpanProcessor({ projectToken: 'phc_...', client: posthog })
 * await posthog.withContext({ distinctId: user.id, properties: { plan: 'pro' } }, () => handleRequest())
 * ```
 */
export class PostHogSpanProcessor implements SpanProcessor {
  private readonly inner: SpanProcessor
  private readonly client?: PostHogContextSource & PrivacyModeGate
  private readonly privacyMode: boolean = false
  private readonly capturedContexts = new WeakMap<ReadableSpan, CapturedContext>()

  constructor(options: PostHogSpanProcessorOptions) {
    const token = normalizeToken(options.projectToken)
    if (!token) {
      console.warn('[PostHogSpanProcessor] projectToken is missing or blank; the processor will be disabled.')
      this.inner = new NoopSpanProcessor()
      return
    }
    this.client = options.client
    this.privacyMode = options.privacyMode === true

    if (options._spanProcessor) {
      this.inner = options._spanProcessor
    } else {
      const host = new URL(normalizeHost(options.host)).origin
      const exporter = new OTLPTraceExporter({
        url: `${host}/i/v0/ai/otel`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      this.inner = new BatchingSpanProcessor(exporter)
    }
  }

  onStart(span: Span, parentContext: Context): void {
    const captured = this.client && captureContext(this.client)
    if (captured) {
      this.capturedContexts.set(span, captured)
    }
    // Forwarded unconditionally — filtering happens in onEnd. We can't filter
    // here because the span hasn't finished yet and may not have AI attributes
    // set. BatchingSpanProcessor.onStart is a no-op so this is safe.
    this.inner.onStart(span, parentContext)
  }

  onEnd(span: ReadableSpan): void {
    const captured = this.capturedContexts.get(span)
    this.capturedContexts.delete(span)
    if (isAISpan(span)) {
      warnIfPostHogAiGatewayOtelAttributes(span.attributes)
      const contextual = captured ? withRequestContext(span, captured) : span
      const shareable = isPrivacyModeEnabled(this.client, this.privacyMode) ? stripContent(contextual) : contextual
      this.inner.onEnd(redactSpan(shareable))
    }
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush()
  }
}
