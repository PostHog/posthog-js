import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

import { serializeTraceRequest } from './otlpJson'

// OpenTelemetry's ExportResultCode values. Kept local because importing the
// enum would pull `@opentelemetry/core` into the published `./otel` subpath.
export const EXPORT_SUCCESS = 0
export const EXPORT_FAILED = 1

export type ExportResult = { code: number; error?: Error }

const DEFAULT_TIMEOUT_MILLIS = 10_000
const MAX_ATTEMPTS = 5
const MAX_RETRY_DELAY_MILLIS = 30_000
// Matches the OpenTelemetry exporters' default concurrency limit.
const MAX_CONCURRENT_EXPORTS = 30
const RETRYABLE_STATUS_CODES = [429, 502, 503, 504]

const SHUTDOWN_RESULT: ExportResult = { code: EXPORT_FAILED, error: new Error('Exporter has been shut down') }
const OVERLOADED_RESULT: ExportResult = { code: EXPORT_FAILED, error: new Error('Too many exports in flight') }

export type OtlpFetchTraceExporterOptions = {
  url: string
  headers: Record<string, string>
  timeoutMillis?: number
}

function retryDelayMillis(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSeconds = Number(retryAfterHeader)
  const delay =
    retryAfterHeader && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 500 * 2 ** attempt * (1 + Math.random())
  return Math.min(delay, MAX_RETRY_DELAY_MILLIS)
}

function sleep(millis: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, millis)
    // Never hold a finished Node process open for a backoff delay.
    ;(timer as unknown as { unref?: () => void }).unref?.()
  })
}

/**
 * A `SpanExporter` that POSTs OTLP/JSON traces with `fetch`.
 *
 * `fetch` is the one HTTP client every runtime PostHog supports provides:
 * Node 20+, browsers, and edge runtimes such as Cloudflare Workers. The
 * upstream `@opentelemetry/exporter-trace-otlp-http` exporter instead resolves
 * a transport per platform, and bundlers for edge runtimes pick its browser
 * build, which needs `XMLHttpRequest` or `sendBeacon`. Neither exists on
 * Cloudflare Workers, so no trace ever left the worker.
 */
export class OtlpFetchTraceExporter implements SpanExporter {
  private readonly url: string
  private readonly headers: Record<string, string>
  private readonly timeoutMillis: number
  private readonly pending = new Set<Promise<void>>()
  private shuttingDown = false

  constructor(options: OtlpFetchTraceExporterOptions) {
    this.url = options.url
    this.headers = { 'Content-Type': 'application/json', ...options.headers }
    this.timeoutMillis = options.timeoutMillis ?? DEFAULT_TIMEOUT_MILLIS
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (this.shuttingDown) {
      resultCallback(SHUTDOWN_RESULT)
      return
    }
    if (spans.length === 0) {
      resultCallback({ code: EXPORT_SUCCESS })
      return
    }
    // Each in-flight request holds its serialized batch for the whole retry
    // window, so refuse rather than grow without a bound.
    if (this.pending.size >= MAX_CONCURRENT_EXPORTS) {
      resultCallback(OVERLOADED_RESULT)
      return
    }

    const request: Promise<void> = this.send(serializeTraceRequest(spans)).then((result) => {
      this.pending.delete(request)
      resultCallback(result)
    })
    this.pending.add(request)
  }

  forceFlush(): Promise<void> {
    return Promise.all(this.pending).then(() => undefined)
  }

  shutdown(): Promise<void> {
    this.shuttingDown = true
    return this.forceFlush()
  }

  private async send(body: string): Promise<ExportResult> {
    let error = new Error('PostHog OTLP export made no attempt')
    let retryAfter: string | null = null

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let retryable: boolean
      try {
        const response = await fetch(this.url, {
          method: 'POST',
          headers: this.headers,
          body,
          signal: AbortSignal.timeout(this.timeoutMillis),
        })
        if (response.ok) {
          // Release the connection back to the pool instead of waiting for GC.
          void response.body?.cancel()
          return { code: EXPORT_SUCCESS }
        }
        // Reading the body drains it, which the retry path needs anyway.
        const detail = await response.text().catch(() => '')
        error = new Error(`PostHog OTLP export failed with status ${response.status}${detail ? `: ${detail}` : ''}`)
        retryable = RETRYABLE_STATUS_CODES.includes(response.status)
        retryAfter = response.headers.get('Retry-After')
      } catch (cause) {
        // Network failures and timeouts are transient, so they follow the same backoff.
        error = new Error('PostHog OTLP export request errored', { cause })
        retryable = true
        retryAfter = null
      }

      if (!retryable) {
        break
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMillis(attempt, retryAfter))
      }
    }

    return { code: EXPORT_FAILED, error }
  }
}
