import type { Span, SpanAttributes, StartSpanOptions } from '@posthog/types'
import type { Logger } from '../types'
import type {
  OtlpSpan,
  ResolvedTracesConfig,
  SpanContextManager,
  SpanRecord,
  TraceSdkContext,
  TracesHost,
} from './types'
import { NOOP_SPAN, PostHogSpan, describeError, inertSpan, monotonicNow } from './span'
import { newSpanId, newTraceId } from './ids'
import { parseTraceparent, sanitizeTracestate } from './traceparent'
import { assignUserAttributes, resolveStartTime, sanitizeName } from './sanitize'
import { buildOtlpSpan, buildOtlpTracesPayload, buildTracesResourceAttributes } from './otlp'
import { isPromise, safeSetTimeout } from '../utils'

// Retriable failures on the same head batch before it is dropped, so a stuck
// batch cannot pin the queue while fresher spans are refused at the cap. The
// budget counts attempts, not elapsed time: on the timer path the backoff
// spreads them over minutes, while a host that calls `flush()` per request
// spends them as fast as the requests arrive.
const MAX_RETRIES_PER_BATCH = 8

const MAX_FLUSH_BACKOFF_EXPONENT = 6
const MAX_FLUSH_BACKOFF_MS = 30_000

type SpanCallback<T> = (span: Span) => T

/** Monotonic where the platform has one, wall clock otherwise. Both are ms, and a platform never switches. */
function clockNow(): number {
  return monotonicNow() ?? Date.now()
}

/** `instanceof` and property access both throw on a hostile proxy; `startSpan` must not. */
function isOwnSpan(value: unknown): value is PostHogSpan {
  try {
    return value instanceof PostHogSpan
  } catch {
    return false
  }
}

function looksLikeSpan(value: unknown): boolean {
  try {
    return typeof (value as Span).traceparent === 'function'
  } catch {
    return false
  }
}

interface ParentContext {
  traceId: string
  parentSpanId?: string
  traceState?: string
}

/**
 * The traces pipeline: span creation, active-span parenting, and OTLP export.
 * Separate from the analytics-events pipeline — own queue, endpoint and flush
 * cycle — mirroring logs and metrics.
 */
export class PostHogTraces {
  private _queue: SpanRecord[] = []
  private _flushTimer?: ReturnType<typeof safeSetTimeout>
  // Serializes flushes: a second caller joins the first instead of double-sending the head.
  private _flushPromise: Promise<number> | null = null
  // A trigger no-ops while a background drain is already pending.
  private _backgroundFlush?: Promise<void>
  private _maxExportBatchSize: number
  // Reset when the warning is emitted, so each warning reports its own window.
  private _droppedSinceWarning = 0
  private _lastDropWarningAt = 0
  private _dropReasons = new Set<string>()
  private _consecutiveFlushFailures = 0
  // Absolute deadline from a `Retry-After` the endpoint sent; cleared on any
  // other outcome so one throttled response cannot pin the delay for the rest
  // of the process. A deadline rather than a duration, so a timer armed while
  // the wait is already part-served counts down the remainder instead of
  // restarting it.
  private _retryAfterUntil = 0
  private _flushTimerFiresAt = 0
  // Separate from the backoff counter: this one belongs to whatever batch is at
  // the head, and resets whenever that batch is removed or shrunk.
  private _headBatchFailures = 0
  // Read only while a budget is in flight, so the head cannot grow to sweep in
  // fresh spans and drop them on a budget they never spent.
  private _headBatchSize = 0
  // Bumped by reset(); a pass whose generation is stale abandons the queue.
  private _generation = 0
  // Live-span accounting: span id -> monotonic start. Ids and numbers only,
  // never the span itself, so a handle the caller drops is still collectable
  // and the bound can be generous. Insertion order is start order, so the
  // oldest entries are at the front and eviction stops at the first live one.
  private _liveSpans = new Map<string, number>()

  constructor(
    private readonly _instance: TracesHost,
    private readonly _config: ResolvedTracesConfig,
    private readonly _logger: Logger,
    private readonly _getContext: () => TraceSdkContext,
    private readonly _contextManager: SpanContextManager,
    /** Told when a span joins the queue, so a serverless host can keep the invocation alive. */
    private readonly _onSpanQueued?: () => void
  ) {
    this._maxExportBatchSize = _config.maxExportBatchSize
  }

  /**
   * Starts a span without making it active. Always returns a handle — an inert
   * one when tracing cannot run — so calling code never branches.
   */
  startSpan(name: string, options?: StartSpanOptions): Span {
    if (this._instance.isDisabled || this._instance.optedOut) {
      return inertSpan(options)
    }

    const explicitParent = options?.parent
    if (explicitParent && typeof explicitParent !== 'string' && !isOwnSpan(explicitParent)) {
      if (looksLikeSpan(explicitParent)) {
        // A child of a no-op is itself a no-op, never an orphan with invented ids.
        this._logger.debug('Span parent is not a span from this SDK; returning an inert span')
        return NOOP_SPAN
      }
      // No `traceparent()` to read: `req.headers.traceparent` is `string[]` when the
      // header arrives twice, and a span from another tracer exposes `spanContext()`
      // instead. Ignored: falls back to the active span, or to a new trace.
      this._logger.debug('Ignoring an unusable span parent')
    }

    const parent = this._resolveParent(options)

    // Swept before the bound is read, so a process that has leaked its way to
    // the bound recovers on the first `startSpan` after the leaks age out.
    this._evictAgedSpans()
    if (this._liveSpans.size >= this._config.maxLiveSpans) {
      this._recordDrop(
        1,
        `the live-span limit (${this._config.maxLiveSpans}) was reached — spans are being started and never ended`
      )
      return inertSpan(options)
    }

    const now = Date.now()
    const startTime = resolveStartTime(options?.startTime, now, this._logger)
    const spanId = newSpanId()
    // Read here rather than from the span: age is elapsed time since this call,
    // so a backdated `startTime` neither ages a span early nor exempts it.
    this._liveSpans.set(spanId, clockNow())

    return new PostHogSpan(
      {
        traceId: parent?.traceId ?? newTraceId(),
        spanId,
        parentSpanId: parent?.parentSpanId,
        traceState: parent?.traceState,
        name: sanitizeName(name, 'Span name', this._logger),
        kind: options?.kind ?? 'internal',
        // Auto-context first so user-supplied attributes win on collision.
        attributes: assignUserAttributes(this._autoContextAttributes(), options?.attributes),
        startTime,
        backdated: startTime !== now,
      },
      (record) => this._onSpanEnd(record),
      this._logger
    )
  }

  /**
   * Runs a callback with a span active for its duration and guarantees the span
   * ends — at return for a sync callback, at settle for an async one.
   *
   * A throw or rejection is recorded on the span and rethrown unmodified: the
   * SDK never swallows application control flow.
   */
  withSpan<T>(name: string, fn: SpanCallback<T>): T
  withSpan<T>(name: string, options: StartSpanOptions, fn: SpanCallback<T>): T
  withSpan<T>(name: string, optionsOrFn: StartSpanOptions | SpanCallback<T>, maybeFn?: SpanCallback<T>): T {
    const options = typeof optionsOrFn === 'function' ? undefined : optionsOrFn
    const fn = (typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn) as SpanCallback<T>

    const span = this.startSpan(name, options)

    try {
      // The shared no-op is never activated, so `getActiveSpan()` inside the
      // callback reads null — callbacks should use the handle they're given. A
      // pass-through handle is activated, so `getActiveSpan()?.traceparent()`
      // still propagates an inbound trace through a service with tracing off.
      const result = span === NOOP_SPAN ? fn(span) : this._contextManager.with(span, () => fn(span))

      if (isPromise(result)) {
        return result.then(
          (value: unknown) => {
            span.end()
            return value
          },
          (error: unknown) => {
            this._recordCallbackError(span, error)
            span.end()
            throw error
          }
        ) as T
      }

      span.end()
      return result
    } catch (error) {
      this._recordCallbackError(span, error)
      span.end()
      throw error
    }
  }

  /** The active span, or `null` outside any `withSpan` callback. */
  getActiveSpan(): Span | null {
    return this._contextManager.active() ?? null
  }

  /**
   * Drains the span queue in repeated passes: joining a single in-flight pass
   * would leave spans enqueued after its watermark behind.
   *
   * A pass reports spans removed — queue length can't stand in, since a send
   * concurrent with an arrival leaves it unchanged.
   *
   * While the endpoint has asked for a wait this sends nothing and leaves the
   * armed timer to retry, so a host that flushes on its own cadence can't spend
   * the head batch's retry budget inside a window where every attempt is
   * refused. `force` is for teardown, which has no later attempt to save.
   */
  async flush({ force = false }: { force?: boolean } = {}): Promise<void> {
    for (;;) {
      if (!this._queue.length) {
        return
      }

      if (!force && this._isWaitingOutRetryAfter()) {
        this._armFlushTimerIfQueuedNoEarlierThan()
        return
      }

      const inFlight = this._flushPromise
      const removed = await (inFlight ?? this._startFlush())

      // No progress means a retriable failure, an abandoned pass, or spans
      // arriving as fast as we send them. Either way, stop rather than spin.
      if (!removed) {
        return
      }
    }
  }

  private _startFlush(): Promise<number> {
    this._clearFlushTimer()
    const promise = this._flushInner().finally(() => {
      // Only clear the slot this call installed: a `reset()` mid-flight may
      // already have installed a newer one.
      if (this._flushPromise === promise) {
        this._flushPromise = null
      }
      this._armFlushTimerIfQueuedNoEarlierThan()
    })
    this._flushPromise = promise
    return promise
  }

  /** Clears the queue and timer. Used on shutdown and between tests. */
  reset(): void {
    this._clearFlushTimer()
    this._queue = []
    this._liveSpans.clear()
    this._flushPromise = null
    // Abandons any in-flight pass, which would otherwise splice out spans it never sent.
    this._generation++
    this._maxExportBatchSize = this._config.maxExportBatchSize
    this._droppedSinceWarning = 0
    this._dropReasons.clear()
    this._lastDropWarningAt = 0
    this._consecutiveFlushFailures = 0
    this._retryAfterUntil = 0
    this._headBatchFailures = 0
  }

  /**
   * Resolves a span's parent: an explicit `parent`, then the active span, then a
   * fresh root. A no-op explicit parent is rejected earlier, in `startSpan`.
   */
  private _resolveParent(options?: StartSpanOptions): ParentContext | undefined {
    const explicit = options?.parent

    if (typeof explicit === 'string') {
      const remote = parseTraceparent(explicit)
      if (!remote) {
        this._logger.debug('Ignoring malformed traceparent; starting a new trace')
        return undefined
      }
      return {
        traceId: remote.traceId,
        parentSpanId: remote.spanId,
        traceState: sanitizeTracestate(options?.tracestate),
      }
    }

    if (isOwnSpan(explicit)) {
      // `tracestate` is ignored for handle parents — the child inherits the
      // parent span's tracestate instead.
      return explicit.childContext()
    }

    const active = this._contextManager.active()
    return isOwnSpan(active) ? active.childContext() : undefined
  }

  /**
   * PostHog context snapshotted at span start. These are the product's join
   * keys — they're what makes a span reachable from a person or a session.
   */
  private _autoContextAttributes(): SpanAttributes {
    let context: TraceSdkContext
    try {
      context = this._getContext()
    } catch (error) {
      this._logger.debug('Failed to read tracing context; span will carry no PostHog attributes', error)
      return {}
    }

    const attributes: SpanAttributes = {}
    if (context.distinctId) {
      attributes.posthogDistinctId = context.distinctId
    }
    if (context.sessionId) {
      attributes.sessionId = context.sessionId
    }
    if (context.currentUrl) {
      attributes['url.full'] = context.currentUrl
    }
    if (context.screenName) {
      attributes['screen.name'] = context.screenName
    }
    if (context.appState) {
      attributes['app.state'] = context.appState
    }
    return attributes
  }

  /**
   * Records a callback failure on the span: an `exception` event always, plus
   * status `error` unless the callback explicitly marked the span `ok`.
   */
  private _recordCallbackError(span: Span, error: unknown): void {
    if (!(span instanceof PostHogSpan)) {
      return
    }
    const { type, message } = describeError(error)
    span.addEvent('exception', { 'exception.type': type, 'exception.message': message })
    if (!span.statusIsExplicitlyOk) {
      span.setStatus('error', message)
    }
  }

  /**
   * Drops live accounting for spans older than `maxSpanAgeMs`. An evicted span
   * is never exported — its `end()` finds no entry — so one leak returns its
   * slot instead of disabling tracing for the rest of the process.
   */
  private _evictAgedSpans(): void {
    const cutoff = clockNow() - this._config.maxSpanAgeMs
    let evicted = 0
    for (const [spanId, startedAt] of this._liveSpans) {
      // Insertion order is start order, so the first entry inside the bound ends the sweep.
      if (startedAt > cutoff) {
        break
      }
      this._liveSpans.delete(spanId)
      evicted++
    }
    if (evicted) {
      this._recordDrop(evicted, `they were still live after ${this._config.maxSpanAgeMs}ms`)
    }
  }

  private _onSpanEnd(record: SpanRecord): void {
    // Deleted before any other gate, so an opted-out span still returns its slot.
    if (!this._liveSpans.delete(record.spanId)) {
      // Evicted for age while live: never exported, and already counted as a drop.
      return
    }

    // Re-checked at end: opting out mid-trace must stop the span exporting.
    if (this._instance.isDisabled || this._instance.optedOut) {
      this._recordDrop(1, 'the user has opted out')
      return
    }

    if (this._queue.length >= this._config.maxQueueSize) {
      // Drop the incoming span, not queued ones: those are completed parents whose
      // children may already have shipped.
      this._recordDrop(
        1,
        `the queue is full (${this._config.maxQueueSize}) — raise the flush frequency or reduce span volume`
      )
      return
    }

    this._queue.push(record)
    try {
      this._onSpanQueued?.()
    } catch (error) {
      this._logger.debug('Span queue notification failed', error)
    }

    // Not while a flush is failing: the queue stays above the batch size for the
    // whole outage, so every further span end would re-POST immediately and the
    // retry backoff would never apply.
    if (this._queue.length >= this._maxExportBatchSize && !this._consecutiveFlushFailures) {
      this._flushInBackground()
    } else {
      this._armFlushTimerIfQueued()
    }
  }

  private _recordDrop(count: number, reason: string): void {
    this._droppedSinceWarning += count
    this._dropReasons.add(reason)
    // Drops also happen with no flush in sight — a full queue during an outage —
    // so the warning is paced by the clock rather than by the flush loop.
    if (Date.now() - this._lastDropWarningAt >= this._config.flushIntervalMs) {
      this._warnAboutDrops()
    }
  }

  /** At most one warning per flush pass, naming the total and every reason behind it. */
  private _warnAboutDrops(): void {
    if (!this._droppedSinceWarning) {
      return
    }
    this._lastDropWarningAt = Date.now()
    this._logger.warn(`Dropping ${this._droppedSinceWarning} span(s): ${[...this._dropReasons].join('; ')}`)
    this._droppedSinceWarning = 0
    this._dropReasons.clear()
  }

  /**
   * Encodes a batch, dropping any span whose attributes can't be encoded.
   * An unguarded throw here would leave the queue unspliced, so every later
   * flush would die on the same span.
   */
  private _encodeBatch(batch: SpanRecord[]): OtlpSpan[] {
    const encoded: OtlpSpan[] = []
    for (const record of batch) {
      try {
        encoded.push(buildOtlpSpan(record, this._logger))
      } catch (error) {
        this._logger.debug('Failed to encode a span; dropping it', error)
        this._recordDrop(1, 'its attributes could not be encoded')
      }
    }
    return encoded
  }

  /** Returns how many spans it removed from the queue, sent or dropped. */
  private async _flushInner(): Promise<number> {
    if (!this._queue.length) {
      return 0
    }

    // Consent can flip between a span being queued and this pass running. Spans
    // carry `posthogDistinctId` and `sessionId`, so anything still queued when
    // the user opts out must be discarded rather than exported.
    if (this._instance.isDisabled || this._instance.optedOut) {
      const discarded = this._queue.length
      this._queue = []
      this._recordDrop(discarded, 'the user has opted out')
      this._warnAboutDrops()
      return discarded
    }

    const resourceAttributes = buildTracesResourceAttributes(
      this._config,
      this._instance.getLibraryId(),
      this._instance.getLibraryVersion()
    )
    const scopeName = this._instance.getLibraryId()
    const scopeVersion = this._instance.getLibraryVersion()

    // Bounded by queue depth at flush start, so mid-drain arrivals ride the next flush.
    let remaining = this._queue.length
    let removed = 0
    const generation = this._generation

    try {
      while (remaining > 0 && this._queue.length > 0) {
        // Floor at one, or a non-positive batch size loops forever on an empty batch.
        const cap =
          this._headBatchFailures > 0
            ? Math.min(this._maxExportBatchSize, this._headBatchSize)
            : this._maxExportBatchSize
        const size = Math.max(1, Math.min(cap, remaining, this._queue.length))
        const batch = this._queue.slice(0, size)
        const spans = this._encodeBatch(batch)

        if (!spans.length) {
          // Nothing survived encoding; drop the batch rather than re-encoding it forever.
          this._queue.splice(0, size)
          remaining -= size
          removed += size
          this._headBatchFailures = 0
          continue
        }

        const outcome = await this._instance._sendTracesBatch(
          buildOtlpTracesPayload(spans, resourceAttributes, scopeName, scopeVersion, this._logger)
        )

        if (generation !== this._generation) {
          // reset() ran mid-send: this pass no longer owns the queue.
          return removed
        }

        // Only a retriable outcome carries a wait; anything else ends it, or a
        // stale one would pin every later flush at the window the server has
        // moved on from.
        this._retryAfterUntil =
          outcome.kind === 'retry-later' && outcome.retryAfterMs ? Date.now() + outcome.retryAfterMs : 0

        if (outcome.kind === 'ok') {
          this._consecutiveFlushFailures = 0
          this._headBatchFailures = 0
          this._queue.splice(0, size)
          remaining -= size
          removed += size
          // Ramp back toward the configured max after a 413 shrink.
          if (this._maxExportBatchSize < this._config.maxExportBatchSize) {
            this._maxExportBatchSize++
          }
          continue
        }

        if (outcome.kind === 'too-large') {
          if (size === 1) {
            // A single span the server won't accept at any size; drop it or it wedges the queue.
            this._queue.splice(0, 1)
            remaining -= 1
            removed += 1
            this._recordDrop(1, 'it is too large for the ingestion endpoint')
            this._headBatchFailures = 0
            continue
          }
          // Halve the batch the server rejected, not the configured maximum: when the
          // queue is shallower than the maximum, shrinking it resends an identical body.
          this._maxExportBatchSize = Math.max(1, Math.floor(size / 2))
          // A different batch from here on, so its budget starts fresh.
          this._headBatchFailures = 0
          this._logger.debug(`Batch too large; retrying the same spans in batches of ${this._maxExportBatchSize}`)
          continue
        }

        if (outcome.kind === 'retry-later') {
          this._consecutiveFlushFailures++
          this._headBatchFailures++
          this._headBatchSize = size
          if (this._headBatchFailures < MAX_RETRIES_PER_BATCH) {
            // Keep the spans queued; the flush timer picks them up again.
            this._logger.debug('Span export failed; retrying on the next flush', outcome.error)
            return removed
          }
          // Out of retries. Drop this batch and start clean on the next one, so a
          // permanently failing head cannot hold the queue against fresher spans.
          this._queue.splice(0, size)
          remaining -= size
          removed += size
          this._consecutiveFlushFailures = 0
          this._headBatchFailures = 0
          this._recordDrop(size, `the ingestion endpoint failed ${MAX_RETRIES_PER_BATCH} times in a row`)
          continue
        }

        // Non-retriable (poison batch or bad key); drop it so it can't wedge the queue.
        this._logger.debug('Dropping a span batch the ingestion endpoint rejected', outcome.error)
        this._queue.splice(0, size)
        remaining -= size
        removed += size
        this._headBatchFailures = 0
        this._recordDrop(size, 'the ingestion endpoint rejected the batch')
      }

      return removed
    } finally {
      // Every exit path, so a queue-full drop during an outage still surfaces —
      // the retriable branch returns early.
      this._warnAboutDrops()
    }
  }

  /**
   * One background drain at a time. `flush()` is a multi-pass loop that keeps
   * going while the queue stays above the batch size, so a trigger per span end
   * would stack a loop per span on a busy service — each retaining its frames.
   */
  private _flushInBackground(): void {
    if (this._backgroundFlush) {
      return
    }
    this._backgroundFlush = this.flush()
      .catch((error) => {
        // Background flushes have no caller to surface to; an explicit flush()
        // still rejects.
        this._logger.debug('Background span flush failed', error)
      })
      .finally(() => {
        this._backgroundFlush = undefined
        // A trigger that arrived while this drain was finishing found the guard
        // set and the queue empty, so neither path armed a timer.
        this._armFlushTimerIfQueuedNoEarlierThan()
      })
  }

  // Arms the flush timer if none is pending. Every span end can reach this, so
  // it must leave a pending timer alone rather than pushing the flush out.
  private _armFlushTimerIfQueued(): void {
    if (this._flushTimer || !this._queue.length) {
      return
    }
    this._setFlushTimer(this._nextFlushDelay())
  }

  // Backoff and `Retry-After` are floors, so a timer a span end armed at the
  // plain interval while the send was in flight has to give way to a longer
  // one — otherwise the retry lands inside the window the server asked us to
  // skip.
  private _armFlushTimerIfQueuedNoEarlierThan(): void {
    if (!this._queue.length) {
      return
    }
    const delayMs = this._nextFlushDelay()
    if (this._flushTimer && Date.now() + delayMs <= this._flushTimerFiresAt) {
      return
    }
    this._clearFlushTimer()
    this._setFlushTimer(delayMs)
  }

  private _setFlushTimer(delayMs: number): void {
    this._flushTimerFiresAt = Date.now() + delayMs
    this._flushTimer = safeSetTimeout(() => {
      this._flushTimer = undefined
      this._flushInBackground()
    }, delayMs)
  }

  // Retry delay: base interval, doubling, capped at 30s — never below an interval
  // a host configured above the cap.
  private _nextFlushDelay(): number {
    const exponent = Math.min(Math.max(0, this._consecutiveFlushFailures - 1), MAX_FLUSH_BACKOFF_EXPONENT)
    const delay = this._config.flushIntervalMs * 2 ** exponent
    const capped = Math.min(delay, Math.max(MAX_FLUSH_BACKOFF_MS, this._config.flushIntervalMs))
    // `Retry-After` is a floor, not a replacement: never retry before the server
    // asked, and never more often than our own backoff would have.
    return Math.max(capped, this._retryAfterRemainingMs())
  }

  private _retryAfterRemainingMs(): number {
    return Math.max(0, this._retryAfterUntil - Date.now())
  }

  private _isWaitingOutRetryAfter(): boolean {
    return this._retryAfterRemainingMs() > 0
  }

  private _clearFlushTimer(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer)
      this._flushTimer = undefined
    }
  }
}
