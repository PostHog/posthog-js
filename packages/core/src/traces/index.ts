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
import { NOOP_SPAN, PostHogSpan, describeError } from './span'
import { newSpanId, newTraceId } from './ids'
import { parseTraceparent, sanitizeTracestate } from './traceparent'
import { clampEndTime, resolveStartTime, sanitizeName } from './sanitize'
import { buildOtlpSpan, buildOtlpTracesPayload, buildTracesResourceAttributes } from './otlp'
import { isPromise, safeSetTimeout } from '../utils'

type SpanCallback<T> = (span: Span) => T

interface ParentContext {
  traceId: string
  parentSpanId?: string
  traceState?: string
}

/**
 * The traces pipeline: span creation, active-span parenting, and OTLP export.
 *
 * Deliberately separate from the analytics-events pipeline — its own queue, its
 * own endpoint, its own flush cycle — mirroring how logs and metrics are modeled.
 */
export class PostHogTraces {
  private _queue: SpanRecord[] = []
  private _flushTimer?: ReturnType<typeof safeSetTimeout>
  // Serializes flushes: a second caller joins the first rather than racing it
  // and double-sending the head of the queue.
  private _flushPromise: Promise<number> | null = null
  // Mutable: halved on 413 to shrink the next POST, then ramped back up by one
  // span per healthy send so a single oversized batch doesn't permanently
  // degrade throughput.
  private _maxExportBatchSize: number
  private _droppedWarned = false
  // Bumped by reset(); a pass whose generation is stale abandons the queue.
  private _generation = 0

  constructor(
    private readonly _instance: TracesHost,
    private readonly _config: ResolvedTracesConfig,
    private readonly _logger: Logger,
    private readonly _getContext: () => TraceSdkContext,
    private readonly _contextManager: SpanContextManager
  ) {
    this._maxExportBatchSize = _config.maxExportBatchSize
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Starts a span without making it active. Always returns a handle — an inert
   * one when tracing cannot run — so calling code never branches.
   */
  startSpan(name: string, options?: StartSpanOptions): Span {
    if (this._instance.isDisabled || this._instance.optedOut) {
      return NOOP_SPAN
    }

    const explicitParent = options?.parent
    if (explicitParent && typeof explicitParent !== 'string' && !(explicitParent instanceof PostHogSpan)) {
      if (typeof (explicitParent as Span).traceparent === 'function') {
        // A child of a no-op is itself a no-op, never an orphan with invented ids.
        // A foreign Span implementation lands here too, which is why it is logged.
        this._logger.debug('Span parent is not a span from this SDK; returning an inert span')
        return NOOP_SPAN
      }
      // Not a span at all — `req.headers.traceparent` is `string[]` when the
      // header arrives twice, and W3C treats that as no inbound context. Ignored
      // like a malformed traceparent string rather than costing the span.
      this._logger.debug('Ignoring an unusable span parent')
    }

    const parent = this._resolveParent(options)

    const now = Date.now()
    const startTime = resolveStartTime(options?.startTime, now, this._logger)

    return new PostHogSpan(
      {
        traceId: parent?.traceId ?? newTraceId(),
        spanId: newSpanId(),
        parentSpanId: parent?.parentSpanId,
        traceState: parent?.traceState,
        name: sanitizeName(name, 'Span name', this._logger),
        kind: options?.kind ?? 'internal',
        // Auto-context first so user-supplied attributes win on collision.
        attributes: { ...this._autoContextAttributes(), ...(options?.attributes ?? {}) },
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
      // A no-op span is never activated, so `getActiveSpan()` inside the
      // callback reads null — callbacks should use the handle they're given.
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
   * Drains the span queue.
   *
   * Runs repeated passes rather than joining a single in-flight one: a flush
   * arriving mid-flight would otherwise return once the active pass finished
   * with its own watermark, leaving spans enqueued after that watermark behind —
   * which would make `shutdown()` silently drop them.
   *
   * A pass reports how many spans it removed, and the drain stops as soon as one
   * removes none. Queue length can't stand in for that: a pass that sends one
   * span while another arrives mid-send leaves the length unchanged, which reads
   * as "no progress" and abandons the new span.
   */
  async flush(): Promise<void> {
    for (;;) {
      if (!this._queue.length) {
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
      this._armFlushTimerIfQueued()
    })
    this._flushPromise = promise
    return promise
  }

  /** Clears the queue and timer. Used on shutdown and between tests. */
  reset(): void {
    this._clearFlushTimer()
    this._queue = []
    this._flushPromise = null
    // Abandons any in-flight pass: it resumes against a queue it no longer
    // owns, so without this it would splice out spans it never sent.
    this._generation++
    this._maxExportBatchSize = this._config.maxExportBatchSize
    this._droppedWarned = false
  }

  // ==========================================================================
  // Span creation internals
  // ==========================================================================

  /**
   * Resolves a span's parent, in precedence order: an explicit `parent`, then
   * the active span, then none (a fresh root).
   *
   * A no-op explicit parent is rejected before this runs, in `startSpan`.
   */
  private _resolveParent(options?: StartSpanOptions): ParentContext | undefined {
    const explicit = options?.parent

    if (typeof explicit === 'string') {
      const remote = parseTraceparent(explicit)
      if (!remote) {
        // A malformed traceparent starts a fresh root rather than throwing —
        // an inbound header is caller-controlled and often absent.
        this._logger.debug('Ignoring malformed traceparent; starting a new trace')
        return undefined
      }
      return {
        traceId: remote.traceId,
        parentSpanId: remote.spanId,
        traceState: sanitizeTracestate(options?.tracestate),
      }
    }

    if (explicit instanceof PostHogSpan) {
      // `tracestate` is ignored for handle parents — the child inherits the
      // parent span's tracestate instead.
      return explicit.childContext()
    }

    const active = this._contextManager.active()
    return active instanceof PostHogSpan ? active.childContext() : undefined
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

  // ==========================================================================
  // Queue and export
  // ==========================================================================

  private _onSpanEnd(incoming: SpanRecord): void {
    // Re-checked at end, not just at start: opting out mid-trace must stop the
    // span exporting, without throwing into code holding a live handle.
    if (this._instance.isDisabled || this._instance.optedOut) {
      return
    }

    const record = this._runBeforeSpanSend(incoming)
    if (!record) {
      return
    }

    if (this._queue.length >= this._config.maxQueueSize) {
      // Drop the incoming span rather than evicting queued ones: the oldest
      // queued spans are completed parents whose children may already have been
      // exported, and dropping them breaks assembled traces retroactively.
      this._recordDrop(
        1,
        `the queue is full (${this._config.maxQueueSize}) — raise the flush frequency or reduce span volume`
      )
      return
    }

    this._queue.push(record)

    if (this._queue.length >= this._maxExportBatchSize) {
      this._flushInBackground()
    } else {
      this._armFlushTimerIfQueued()
    }
  }

  /**
   * Runs the `beforeSpanSend` chain, returning the span to enqueue or `null` to
   * drop it.
   *
   * A throwing hook drops the span. The hook is the documented scrubbing point,
   * so a scrubber that breaks must not let the unscrubbed record through.
   *
   * Identity fields are restored afterwards: rewriting them would orphan
   * children that already shipped with the original parent id.
   */
  private _runBeforeSpanSend(record: SpanRecord): SpanRecord | null {
    if (!this._config.beforeSpanSend.length) {
      return record
    }

    const identity = { traceId: record.traceId, spanId: record.spanId, parentSpanId: record.parentSpanId }
    let current = record

    for (const hook of this._config.beforeSpanSend) {
      let result: SpanRecord | null
      try {
        result = hook(current)
      } catch (error) {
        this._logger.warn('beforeSpanSend threw; dropping the span rather than exporting it unscrubbed', error)
        return null
      }
      if (!result) {
        return null
      }
      current = result
    }

    if (
      current.traceId !== identity.traceId ||
      current.spanId !== identity.spanId ||
      current.parentSpanId !== identity.parentSpanId
    ) {
      this._logger.debug('beforeSpanSend changed a span identity field; keeping the original ids')
      current.traceId = identity.traceId
      current.spanId = identity.spanId
      current.parentSpanId = identity.parentSpanId
    }

    current.name = sanitizeName(current.name, 'Span name', this._logger)
    current.endTime = clampEndTime(current.endTime, current.startTime)
    return current
  }

  private _recordDrop(count: number, reason: string): void {
    if (!this._droppedWarned) {
      this._droppedWarned = true
      this._logger.warn(`Dropping ${count} span(s): ${reason}`)
    }
  }

  /**
   * Encodes a batch, dropping any single span whose attributes cannot be
   * encoded — a throwing getter, most likely, since cycles degrade to a marker.
   *
   * Encoding runs before the send and outside the outcome handling, so an
   * unguarded throw here would leave the queue unspliced and every later flush
   * would die on the same span, taking the whole pipeline down silently. Both
   * sibling pipelines guard their serialization the same way.
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

    const resourceAttributes = buildTracesResourceAttributes(
      this._config,
      this._instance.getLibraryId(),
      this._instance.getLibraryVersion()
    )
    const scopeName = this._instance.getLibraryId()
    const scopeVersion = this._instance.getLibraryVersion()

    // Warn again about drops in this pass even if an earlier one already did.
    this._droppedWarned = false

    // Bounded by the queue depth at flush start, so spans enqueued mid-drain
    // ride the next flush instead of extending this one indefinitely.
    let remaining = this._queue.length
    let removed = 0
    const generation = this._generation

    while (remaining > 0 && this._queue.length > 0) {
      // Floor at one: a host that resolved a non-positive batch size would
      // otherwise make no progress and loop forever on an empty batch.
      const size = Math.max(1, Math.min(this._maxExportBatchSize, remaining, this._queue.length))
      const batch = this._queue.slice(0, size)
      const spans = this._encodeBatch(batch)

      if (!spans.length) {
        // Nothing survived encoding; drop the batch rather than re-encoding it
        // on every future flush.
        this._queue.splice(0, size)
        remaining -= size
        removed += size
        continue
      }

      const outcome = await this._instance._sendTracesBatch(
        buildOtlpTracesPayload(spans, resourceAttributes, scopeName, scopeVersion, this._logger)
      )

      if (generation !== this._generation) {
        // reset() ran while the send was in flight — the client was torn down,
        // so this pass no longer owns the queue and must not touch it.
        return removed
      }

      if (outcome.kind === 'ok') {
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
          // A single span the server won't accept at any batch size. Dropping
          // it is the only way to stop it wedging the queue behind it.
          this._queue.splice(0, 1)
          remaining -= 1
          removed += 1
          this._recordDrop(1, 'the ingestion endpoint rejected it as too large')
          continue
        }
        // Halve the batch the server rejected, not the configured maximum: when the
        // queue is shallower than the maximum, shrinking the maximum leaves the batch
        // the same size and resends the identical body.
        this._maxExportBatchSize = Math.max(1, Math.floor(size / 2))
        this._logger.debug(`Batch too large; retrying the same spans in batches of ${this._maxExportBatchSize}`)
        continue
      }

      if (outcome.kind === 'retry-later') {
        // Keep the spans queued; the flush timer picks them up again.
        this._logger.debug('Span export failed; retrying on the next flush', outcome.error)
        return removed
      }

      // Non-retriable: a poison batch or a bad key. Drop it so it can't wedge
      // the queue behind it.
      this._logger.debug('Dropping a span batch the ingestion endpoint rejected', outcome.error)
      this._queue.splice(0, size)
      remaining -= size
      removed += size
      this._recordDrop(size, 'the ingestion endpoint rejected the batch')
    }

    return removed
  }

  private _flushInBackground(): void {
    void this.flush().catch((error) => {
      // Background flushes have no caller to surface to; an explicit flush()
      // still rejects.
      this._logger.debug('Background span flush failed', error)
    })
  }

  private _armFlushTimerIfQueued(): void {
    if (this._flushTimer || !this._queue.length) {
      return
    }
    this._flushTimer = safeSetTimeout(() => {
      this._flushTimer = undefined
      this._flushInBackground()
    }, this._config.flushIntervalMs)
  }

  private _clearFlushTimer(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer)
      this._flushTimer = undefined
    }
  }
}
