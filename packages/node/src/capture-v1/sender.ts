import {
  type FetchLike,
  type PostHogFetchBodyBytes,
  type PostHogFetchOptions,
  type PostHogFetchResponse,
  gzipCompress,
  uuidv7,
} from '@posthog/core'

import { CaptureError, type CaptureDroppedEvent, type CaptureErrorParams } from './errors'
import { type SerializedV1Event, buildV1Body } from './serialize'
import type { CaptureEndpoint, V1BatchResponse } from './types'

/** Wait before the first retry; each later retry doubles it. */
export const RETRY_BASE_DELAY_MS = 100
/** Ceiling for every retry wait, including one raised by `Retry-After`. */
export const MAX_RETRY_DELAY_MS = 30_000

// Retry waits and request deadlines use ref'd timers, unlike safeSetTimeout, so an
// awaited flush or shutdown keeps the process alive until the send finishes.
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    // A lane reuses one signal for every send, so a finished wait must not leave its listener behind.
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** HTTP statuses the v1 backend wants retried. 429 is intentionally terminal in v1. */
const RETRYABLE_STATUSES = new Set([408, 500, 502, 503, 504])

export interface V1CaptureSenderConfig {
  host: string
  /** The capture lane this sender posts to. */
  path: CaptureEndpoint
  apiKey: string
  /** Canonical `$lib` identity, materialized by the server from `PostHog-Sdk-Info`. */
  libraryId: string
  libraryVersion: string
  /** Value for the `User-Agent` header, if the runtime allows setting it. */
  userAgent?: string
  historicalMigration: boolean
  /** When true, the body is gzip-compressed (falling back to uncompressed on failure). */
  compressionEnabled: boolean
  requestTimeoutMs: number
  /** Retries after the first attempt. */
  maxRetries: number
  isDebug?: boolean
}

export interface V1CaptureSenderHooks {
  fetch: FetchLike
  /** Surfaces partial/terminal delivery failures on the client error channel. */
  onError: (error: Error) => void
  now?: () => number
  /** Waits between attempts. The sender stops waiting when `signal` aborts, even if this does not. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  generateRequestId?: () => string
  /** Uniform in [0, 1); sets the jitter of each retry wait. */
  random?: () => number
  compress?: (payload: string, isDebug?: boolean) => Promise<Blob | PostHogFetchBodyBytes | null>
}

export interface V1SendOptions {
  /** Aborting stops the current attempt and every later one; the pending events come back as unsent. */
  signal?: AbortSignal
  /**
   * When true, events whose last attempt got no HTTP response (or were cut off by `signal`) are
   * returned to the caller unreported, so it can queue them again. When false they are reported
   * as undelivered.
   */
  keepUnsent?: boolean
}

interface V1CaptureAttempt {
  response: PostHogFetchResponse
  signal: AbortSignal
  waitFor<T>(operation: Promise<T>): Promise<T>
  cancelBody: () => Promise<void>
  cleanup: () => void
}

/**
 * Sends already-serialized events to one Capture V1 lane (`config.path`),
 * owning the full attempt loop: per-event partial retry, exponential backoff
 * clamped against `Retry-After`, v1 status classification, and surfacing drops
 * / undelivered events on the error channel. Used by both the batched and
 * immediate send paths.
 *
 * Never throws for a handled outcome: after exhausting its own attempt budget it
 * reports the failure via `onError` and resolves. Only events that never got an
 * HTTP response can come back to the caller, and only with `keepUnsent`.
 */
export class V1CaptureSender {
  private readonly config: V1CaptureSenderConfig
  private readonly fetchFn: FetchLike
  private readonly onError: (error: Error) => void
  private readonly now: () => number
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly generateRequestId: () => string
  private readonly random: () => number
  private readonly compress: (payload: string, isDebug?: boolean) => Promise<Blob | PostHogFetchBodyBytes | null>

  constructor(config: V1CaptureSenderConfig, hooks: V1CaptureSenderHooks) {
    this.config = config
    this.fetchFn = hooks.fetch
    this.onError = hooks.onError
    this.now = hooks.now ?? Date.now
    this.sleep = hooks.sleep ?? abortableSleep
    this.generateRequestId = hooks.generateRequestId ?? uuidv7
    this.random = hooks.random ?? Math.random
    this.compress = hooks.compress ?? gzipCompress
  }

  /** Sends `events` and resolves with the ones to queue again (always empty unless `keepUnsent`). */
  async send<T extends SerializedV1Event>(events: T[], options: V1SendOptions = {}): Promise<T[]> {
    if (events.length === 0) {
      return []
    }

    const { signal, keepUnsent = false } = options
    const requestId = this.generateRequestId()
    // created_at is generated once and stays stable across every retry.
    const createdAt = new Date(this.now()).toISOString()
    const url = `${this.config.host}${this.config.path}`
    const drops: CaptureDroppedEvent[] = []
    let pending = events

    const unsent = (cause: unknown): T[] => {
      if (keepUnsent) {
        this.surfacePartialDrops(requestId, drops)
        return pending
      }
      this.surfaceBatchFailure(requestId, drops, pending, cause)
      return []
    }

    // Always make one attempt, so a bad budget reports a delivery error instead of dropping the batch silently.
    const { maxRetries } = this.config
    const maxAttempts = (Number.isInteger(maxRetries) && maxRetries > 0 ? maxRetries : 0) + 1
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        return unsent(signal.reason)
      }
      const isLastAttempt = attempt === maxAttempts
      const payload = buildV1Body(pending, { createdAt, historicalMigration: this.config.historicalMigration })

      let captureAttempt: V1CaptureAttempt | undefined
      let retryDelayMs: number | undefined
      try {
        captureAttempt = await this.sendOnce(url, payload, attempt, requestId, signal)
        const { response, signal: attemptSignal } = captureAttempt
        const { status } = response
        if (status < 200 || status >= 300) {
          if (!isLastAttempt && RETRYABLE_STATUSES.has(status)) {
            const retryAfterMs = this.parseRetryAfter(response)
            await captureAttempt.waitFor(captureAttempt.cancelBody()).catch(() => {})
            retryDelayMs = this.backoffDelay(attempt, retryAfterMs)
          } else {
            const httpError = await this.buildHttpError(response, status, captureAttempt.waitFor)
            this.surfaceBatchFailure(requestId, drops, pending, httpError)
            return []
          }
        } else {
          let parsed: V1BatchResponse
          try {
            parsed = await captureAttempt.waitFor(this.parseResponse(response))
          } catch (error) {
            if (attemptSignal.aborted) {
              throw error
            }
            // A 2xx we cannot parse is terminal — re-sending against a broken success would loop forever.
            this.surfaceBatchFailure(
              requestId,
              drops,
              pending,
              new Error(`Capture V1 returned an unparseable ${status} response body`)
            )
            return []
          }

          const retryable = this.classify(pending, parsed, drops)
          if (retryable.length === 0) {
            this.surfacePartialDrops(requestId, drops)
            return []
          }
          if (isLastAttempt) {
            this.onError(
              this.captureError({
                requestId,
                drops,
                retryExhausted: retryable.map((event) => event.uuid),
              })
            )
            return []
          }
          pending = retryable
          // A 200 partial-retry body can also carry Retry-After (e.g. rate-limited
          // retry events); honor it as a minimum the same way as on a retryable status.
          const retryAfterMs = this.parseRetryAfter(response)
          retryDelayMs = this.backoffDelay(attempt, retryAfterMs)
        }
      } catch (transportError) {
        if (captureAttempt && !captureAttempt.signal.aborted) {
          throw transportError
        }
        // Connection/timeouts, including a timeout while consuming the response body,
        // are retried until the budget runs out.
        if (isLastAttempt || signal?.aborted) {
          return unsent(transportError)
        }
        retryDelayMs = this.backoffDelay(attempt)
      } finally {
        captureAttempt?.cleanup()
      }

      if (retryDelayMs !== undefined) {
        await this.sleepUnlessAborted(retryDelayMs, signal)
      }
    }
    return []
  }

  private async sleepUnlessAborted(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (!signal) {
      return this.sleep(ms)
    }
    if (signal.aborted) {
      return
    }
    let onAbort!: () => void
    const aborted = new Promise<void>((resolve) => {
      onAbort = resolve
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      await Promise.race([this.sleep(ms, signal), aborted])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private async sendOnce(
    url: string,
    payload: string,
    attempt: number,
    requestId: string,
    externalSignal: AbortSignal | undefined
  ): Promise<V1CaptureAttempt> {
    const headers = this.buildHeaders(attempt, requestId)
    let body: string | Blob | PostHogFetchBodyBytes = payload
    if (this.config.compressionEnabled) {
      const compressed = await this.compress(payload, this.config.isDebug)
      if (compressed !== null) {
        body = compressed
        headers['Content-Encoding'] = 'gzip'
      }
      // A codec that fails to compress falls back to sending uncompressed.
    }

    const controller = new AbortController()
    let timeoutPhase = 'waiting for response headers'
    let timer: ReturnType<typeof setTimeout> | undefined
    let onExternalAbort: (() => void) | undefined
    const stopListening = (): void => {
      if (onExternalAbort) {
        externalSignal?.removeEventListener('abort', onExternalAbort)
      }
    }
    // hooks.fetch is user-injectable, so it may ignore an abort signal while
    // resolving headers or reading the body. Race both phases against the same
    // deadline rather than relying only on standards-compliant fetch behavior.
    const deadline = new Promise<never>((_resolve, reject) => {
      const abortWith = (error: Error): void => {
        // Reject first so this phase-specific error wins even when an abort-aware
        // custom fetch rejects synchronously from the abort event.
        reject(error)
        controller.abort(error)
      }
      timer = setTimeout(() => {
        const timeoutError = new Error(
          `Capture V1 request timed out ${timeoutPhase} after ${this.config.requestTimeoutMs}ms`
        )
        timeoutError.name = 'AbortError'
        abortWith(timeoutError)
      }, this.config.requestTimeoutMs)
      if (externalSignal) {
        onExternalAbort = () => {
          const abortError = new Error(`Capture V1 request aborted ${timeoutPhase}`)
          abortError.name = 'AbortError'
          abortError.cause = externalSignal.reason
          abortWith(abortError)
        }
        if (externalSignal.aborted) {
          onExternalAbort()
        } else {
          externalSignal.addEventListener('abort', onExternalAbort, { once: true })
        }
      }
    })
    // Keeps an early abort from surfacing as an unhandled rejection before the race below observes it.
    deadline.catch(() => {})
    try {
      const fetchPromise = this.fetchFn(url, { method: 'POST', headers, body, signal: controller.signal })
      let responseAccepted = false
      void fetchPromise
        .then((lateResponse) => {
          if (controller.signal.aborted && !responseAccepted) {
            // An injected fetch may ignore abort and resolve after the deadline.
            // Cancel its otherwise unreachable body to release any held resources.
            void this.cancelBody(lateResponse)
          }
        })
        .catch(() => {})
      const response = await Promise.race([fetchPromise, deadline])
      responseAccepted = true
      timeoutPhase = 'while reading the response body'
      let cleanedUp = false
      let cancellation: Promise<void> | undefined
      const cancelBody = (): Promise<void> => (cancellation ??= this.cancelBody(response))
      return {
        response,
        signal: controller.signal,
        waitFor: <T>(operation: Promise<T>) => Promise.race([operation, deadline]),
        cancelBody,
        cleanup: () => {
          if (cleanedUp) {
            return
          }
          cleanedUp = true
          clearTimeout(timer)
          stopListening()
          if (controller.signal.aborted) {
            // The attempt deadline has already elapsed, so cleanup cannot wait
            // for a custom response body's cancellation promise to settle.
            void cancelBody()
          }
        },
      }
    } catch (error) {
      clearTimeout(timer)
      stopListening()
      throw error
    }
  }

  private buildHeaders(attempt: number, requestId: string): PostHogFetchOptions['headers'] {
    const sdkInfo = `${this.config.libraryId}/${this.config.libraryVersion}`
    const headers: { [key: string]: string } = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      'PostHog-Sdk-Info': sdkInfo,
      'PostHog-Attempt': String(attempt),
      'PostHog-Request-Id': requestId,
      // Regenerated per attempt — a per-attempt wall-clock stamp, unlike Request-Id / created_at.
      'PostHog-Request-Timestamp': new Date(this.now()).toISOString(),
    }
    if (this.config.userAgent) {
      headers['User-Agent'] = this.config.userAgent
    }
    return headers
  }

  /**
   * Partition the pending events against a 2xx result map: `drop` accumulates as
   * a terminal failure, `retry` is returned for the next attempt, and
   * `ok`/`warning`/unknown/absent are terminal successes.
   */
  private classify<T extends SerializedV1Event>(
    pending: T[],
    parsed: V1BatchResponse,
    drops: CaptureDroppedEvent[]
  ): T[] {
    const results = parsed.results ?? {}
    const retryable: T[] = []
    for (const event of pending) {
      const result = results[event.uuid]
      if (!result) {
        continue
      }
      if (result.result === 'drop') {
        drops.push({ uuid: event.uuid, details: result.details ?? undefined })
      } else if (result.result === 'retry') {
        retryable.push(event)
      }
      // ok / warning / unknown codes are terminal successes.
    }
    return retryable
  }

  /** The wait after failed attempt `attempt` (1-based): jittered exponential backoff, raised to `Retry-After`. */
  private backoffDelay(attempt: number, retryAfterMs?: number): number {
    const jitter = 0.75 + 0.5 * this.random()
    const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) * jitter, MAX_RETRY_DELAY_MS)
    if (retryAfterMs === undefined) {
      return backoff
    }
    // Compared after jitter, so jitter can never make the wait shorter than Retry-After.
    return Math.max(backoff, Math.min(retryAfterMs, MAX_RETRY_DELAY_MS))
  }

  /** Parse `Retry-After` (delta-seconds or HTTP-date). Non-positive/past values are ignored. */
  private parseRetryAfter(response: PostHogFetchResponse): number | undefined {
    const raw = response.headers?.get('Retry-After')
    if (!raw) {
      return undefined
    }
    const trimmed = raw.trim()
    if (/^\d+$/.test(trimmed)) {
      const seconds = parseInt(trimmed, 10)
      return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined
    }
    const dateMs = Date.parse(trimmed)
    if (Number.isNaN(dateMs)) {
      return undefined
    }
    const delta = dateMs - this.now()
    return delta > 0 ? delta : undefined
  }

  private async parseResponse(response: PostHogFetchResponse): Promise<V1BatchResponse> {
    const text = await response.text()
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('unexpected response shape')
    }
    const results = (parsed as { results?: unknown }).results
    if (results !== undefined && (typeof results !== 'object' || results === null || Array.isArray(results))) {
      throw new Error('unexpected results shape')
    }
    return { results: (results as V1BatchResponse['results']) ?? {} }
  }

  private async buildHttpError(
    response: PostHogFetchResponse,
    status: number,
    waitFor: V1CaptureAttempt['waitFor']
  ): Promise<Error> {
    let bodyText = ''
    try {
      bodyText = (await waitFor(response.text())).slice(0, 512)
    } catch {
      // best-effort; a missing or timed-out body should not mask the status
    }
    const suffix = bodyText ? `: ${bodyText}` : ''
    return new Error(`Capture V1 request failed with HTTP ${status}${suffix}`)
  }

  private surfaceBatchFailure(
    requestId: string,
    drops: CaptureDroppedEvent[],
    pending: SerializedV1Event[],
    cause: unknown
  ): void {
    this.onError(this.captureError({ requestId, drops, retryExhausted: pending.map((event) => event.uuid), cause }))
  }

  private surfacePartialDrops(requestId: string, drops: CaptureDroppedEvent[]): void {
    if (drops.length > 0) {
      this.onError(this.captureError({ requestId, drops, retryExhausted: [] }))
    }
  }

  private captureError(params: Omit<CaptureErrorParams, 'endpoint'>): CaptureError {
    return new CaptureError({ endpoint: this.config.path, ...params })
  }

  private async cancelBody(response: PostHogFetchResponse): Promise<void> {
    try {
      await response.body?.cancel()
    } catch {
      // Cancellation is best-effort and must never mask delivery handling.
    }
  }
}
