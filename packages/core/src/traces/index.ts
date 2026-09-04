import type { Span, SpanAttributes, SpanRecord as HookSpanRecord, StartSpanOptions } from '@posthog/types'
import type { Logger } from '../types'
import type {
  OtlpSpan,
  ResolvedTracesConfig,
  SpanContextManager,
  SpanEventRecord,
  SpanRecord,
  TraceSdkContext,
  TracesHost,
} from './types'
import {
  PostHogSpan,
  applySpanLimits,
  describeError,
  inertSpan,
  monotonicNow,
  runWithActiveSpan,
  truncateAttributes,
} from './span'
import { newSpanId, newTraceId } from './ids'
import { parseTraceparent, sanitizeTracestate } from './traceparent'
import { clampEndTime, resolveStartTime, resolveSuppliedTime, sanitizeName, toEpochMs } from './sanitize'
import { assignUserAttributes } from '../utils/json-utils'
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

/**
 * The rebuilt record with every field named, optional ones included. A field
 * added to either half of `SpanRecord` is a compile error at the rebuild until
 * it says whether a hook may set that field or the span keeps its own value.
 */
type RebuiltSpanRecord = { [K in keyof Required<SpanRecord>]: SpanRecord[K] }

interface SpanIdentity {
  traceId: string
  spanId: string
  parentSpanId?: string
  traceState?: string
}

/**
 * Whether a `beforeSpanSend` return value still carries every field the public
 * `SpanRecord` declares as required. An array is rejected for `attributes`: it
 * would encode as `{ "0": ... }` rather than fail.
 *
 * Presence, not usability: a field that is there but holds the wrong type is a
 * hook editing a real record badly, and the sanitising below is what answers
 * that. A field that is absent means the hook returned something that was never
 * a span record, and the fallbacks would dress it up as one.
 */
function isSpanRecordShape(record: SpanRecord): boolean {
  return (
    !!record.attributes &&
    typeof record.attributes === 'object' &&
    !Array.isArray(record.attributes) &&
    Array.isArray(record.events) &&
    record.name !== undefined &&
    record.kind !== undefined &&
    record.startTime !== undefined &&
    record.endTime !== undefined
  )
}

/** Writes `value` onto `record` only when it isn't already there. */
function restoreField<K extends keyof SpanIdentity>(record: SpanIdentity, field: K, value: SpanIdentity[K]): void {
  if (record[field] !== value) {
    record[field] = value
  }
}

/**
 * A stand-in for a record whose identity could not be written back, carrying the
 * original ids and everything else the hook returned.
 *
 * Built from the descriptors rather than spread so a class instance keeps its
 * prototype — `instanceof` and a field exposed as a prototype getter both still
 * answer — and so `Object.keys` reads what it read before. Only the four
 * identity descriptors are replaced, which is what makes the copy writable where
 * the original was frozen.
 */
function withRestoredIdentity(hooked: HookSpanRecord, original: SpanIdentity): HookSpanRecord {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(hooked) as Record<string, PropertyDescriptor>
    for (const field of ['traceId', 'spanId', 'parentSpanId', 'traceState'] as const) {
      descriptors[field] = {
        value: original[field],
        enumerable: true,
        writable: true,
        configurable: true,
      }
    }
    return Object.create(Object.getPrototypeOf(hooked) as object | null, descriptors) as HookSpanRecord
  } catch {
    // A hostile descriptor read. The export still uses the snapshot, so this
    // costs the next hook a correct id rather than the span.
    return hooked
  }
}

interface ParentContext {
  traceId: string
  parentSpanId?: string
  traceState?: string
  traceFlags?: string
  /** True when the parent arrived as a `traceparent` header. */
  isRemote?: boolean
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
        // Inert like its parent, never an orphan with invented ids — but a
        // pass-through parent's inbound context carries to the child rather than
        // the trace ending here.
        this._logger.debug('Span parent is not a span from this SDK; returning an inert span')
        return inertSpan(options)
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

    const autoAttributes = this._autoContextAttributes()

    return new PostHogSpan(
      {
        traceId: parent?.traceId ?? newTraceId(),
        spanId,
        parentSpanId: parent?.parentSpanId,
        traceState: parent?.traceState,
        traceFlags: parent?.traceFlags,
        parentIsRemote: parent?.isRemote,
        name: sanitizeName(name, 'Span name', this._config.maxAttributeValueLength, this._logger),
        kind: options?.kind ?? 'internal',
        // Auto-context first so user-supplied attributes win on collision.
        attributes: assignUserAttributes({ ...autoAttributes }, options?.attributes),
        autoAttributeKeys: Object.keys(autoAttributes),
        maxAttributes: this._config.maxAttributesPerSpan,
        maxEvents: this._config.maxEventsPerSpan,
        maxAttributesPerEvent: this._config.maxAttributesPerEvent,
        maxAttributeValueLength: this._config.maxAttributeValueLength,
        startTime,
        backdated: startTime !== now,
      },
      (record, autoKeys) => this._onSpanEnd(record, autoKeys),
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
      const result = runWithActiveSpan(this._contextManager, span, fn)

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
    // Deferred by a microtask so the slot below is installed before the pass
    // reads anything: `_flushInner` runs synchronously as far as its first
    // await, and a resource-attribute getter or `toJSON` that ends a span in
    // that window would otherwise re-enter here, find no pass in flight, and
    // send the same head batch again — without bound.
    // Sampled before the microtask, not inside `_flushInner`: a `reset()` landing
    // in the window would otherwise be invisible to this pass, which would then
    // drain the post-reset queue alongside the pass `reset()` started.
    const startedAtGeneration = this._generation
    const promise = Promise.resolve()
      .then(() => (startedAtGeneration === this._generation ? this._flushInner() : 0))
      .finally(() => {
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
    if (this._queue.length) {
      // Critical, and said here rather than counted: this is the last chance to
      // say anything about these spans, the drop warning is gated behind `debug`
      // on some hosts, and the only other line the caller sees is the export
      // failure promising a retry on a flush that will never come.
      this._logger.critical(
        `Discarding ${this._queue.length} span(s) that were still queued when tracing was shut down. ` +
          'Raise the shutdown timeout or flush earlier if they matter.'
      )
    }
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
        traceFlags: remote.flags,
        isRemote: true,
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
    const { type, message, stack } = describeError(error)
    span.addEvent('exception', {
      'exception.type': type,
      'exception.message': message,
      ...(stack && { 'exception.stacktrace': stack }),
    })
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

  private _onSpanEnd(incoming: SpanRecord, autoKeys: ReadonlySet<string>): void {
    // Deleted before any other gate, so a span dropped later still returns its slot.
    if (!this._liveSpans.delete(incoming.spanId)) {
      // Evicted for age while live: never exported, and already counted as a drop.
      return
    }

    // Re-checked at end: opting out mid-trace must stop the span exporting.
    if (this._instance.isDisabled || this._instance.optedOut) {
      this._recordDrop(1, 'the user has opted out')
      return
    }

    const record = this._runBeforeSpanSend(incoming, autoKeys)
    if (!record) {
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

  /**
   * Runs the `beforeSpanSend` chain, returning the span to enqueue or `null` to
   * drop it.
   *
   * A throwing hook drops the span: the hook is the documented scrubbing point,
   * so a broken scrubber must not let the unscrubbed record through. Identity
   * fields are restored afterwards, since rewriting them orphans shipped children.
   */
  private _runBeforeSpanSend(record: SpanRecord, autoKeys: ReadonlySet<string>): SpanRecord | null {
    if (!this._config.beforeSpanSend.length) {
      return record
    }

    // Snapshotted before any hook runs: a hook that mutates in place would
    // otherwise leave nothing to restore from.
    const identity = {
      traceId: record.traceId,
      spanId: record.spanId,
      parentSpanId: record.parentSpanId,
      traceState: record.traceState,
    }
    const originalTimes = { startTime: record.startTime, endTime: record.endTime }
    // Snapshotted with the rest: the hook mutates the record in place, so reading
    // these back afterwards reads whatever the hook left there.
    const originalDropped = {
      attributes: record.droppedAttributesCount,
      events: record.droppedEventsCount,
    }
    // Read here rather than restored onto the hook's return value: writing them
    // back would throw on a frozen record, and neither is on the record a hook
    // is handed, so a rebuilding hook always arrives without them.
    // The order the span itself wrote them in, so the caps below can keep the
    // earliest-set entries even when a hook adds an integer-like key.
    const keysBeforeHook = Object.keys(record.attributes)
    const originalPropagation = {
      traceFlags: record.traceFlags,
      parentIsRemote: record.parentIsRemote,
    }
    // Copied, not referenced: the hook is documented as mutating the record in
    // place, and a reference would restore the mutation onto itself.
    const originalStatus = record.status && { ...record.status }
    let hooked: HookSpanRecord = record
    let current = record
    try {
      for (const hook of this._config.beforeSpanSend) {
        const result = hook(hooked)
        if (!result) {
          this._recordDrop(1, 'beforeSpanSend dropped it')
          return null
        }
        hooked = this._keepSpanIdentity(result, identity)
      }

      // Rebuilt field by field before anything below writes to it. The hook's
      // return value may be frozen, where every write here would throw, or a
      // class instance whose fields are prototype getters a spread would miss.
      // Naming them also bounds what can reach the wire.
      const rebuilt: RebuiltSpanRecord = {
        // All four from the snapshot, never from the hook's return value. A hook
        // that forges an id has it ignored, which is the documented behaviour,
        // and one that also freezes what it returns keeps its span: writing the
        // id back onto a frozen object throws, and a throw here drops the span.
        traceId: identity.traceId,
        spanId: identity.spanId,
        parentSpanId: identity.parentSpanId,
        traceState: identity.traceState,
        name: hooked.name,
        kind: hooked.kind,
        status: hooked.status,
        attributes: hooked.attributes,
        events: hooked.events,
        startTime: hooked.startTime,
        endTime: hooked.endTime,
        // Taken from the span for the same reason as the dropped counts: no
        // public type declares them, so a rebuilding hook returns without them
        // and a `?? fallback` here would export a sampled-out trace as sampled.
        traceFlags: originalPropagation.traceFlags,
        parentIsRemote: originalPropagation.parentIsRemote,
        // Taken from the span, not from the hook's return value: these are SDK
        // bookkeeping that no public type declares, so a hook overwriting them
        // must not erase what the span actually dropped.
        droppedAttributesCount: originalDropped.attributes,
        droppedEventsCount: originalDropped.events,
      }
      current = rebuilt
      // A value missing a required field is not a span record — an `async` hook
      // returns a Promise, truthy and `undefined` for every field. Filling the
      // gaps in would export a span named `unknown` at a fallback time carrying
      // no person or session, joinable to nothing and silent about it.
      if (!isSpanRecordShape(current)) {
        this._logger.debug('beforeSpanSend did not return a span record; dropping the span')
        this._recordDrop(1, 'beforeSpanSend returned an unusable record')
        return null
      }

      // Re-applied to whatever the hook returned: one undecodable timestamp 400s
      // the whole request, taking unrelated spans with it.
      current.name = sanitizeName(current.name, 'Span name', this._config.maxAttributeValueLength, this._logger)
      // A status the hook rewrote never went through `setStatus`. An unknown code
      // encodes as an empty status object, which loses an error the span really had.
      if (current.status && current.status.code !== 'ok' && current.status.code !== 'error') {
        this._logger.debug('beforeSpanSend set an unknown span status; keeping the original')
        current.status = originalStatus
      }
      current.startTime = toEpochMs(current.startTime) ?? originalTimes.startTime
      current.endTime = clampEndTime(toEpochMs(current.endTime) ?? originalTimes.endTime, current.startTime)
      // Events a hook pushed never went through `addEvent`, so they carry no
      // sanitised name or timestamp; an unvalidated one encodes as `NaN000NaN`
      // and the ingestion service refuses the whole batch.
      const sanitizedEvents: SpanEventRecord[] = []
      for (const event of current.events) {
        try {
          sanitizedEvents.push({
            ...event,
            name: sanitizeName(event.name, 'Span event name', this._config.maxAttributeValueLength, this._logger),
            timestamp: resolveSuppliedTime(event.timestamp, current.startTime, 'event timestamp', this._logger),
          })
        } catch {
          // A hook can leave a `null` in the array or a throwing accessor on an
          // event. That costs the event; the rest of the span still ships.
          this._logger.debug('beforeSpanSend left an unreadable span event; dropping it')
        }
      }
      current.events = sanitizedEvents
      applySpanLimits(
        current,
        autoKeys,
        this._config.maxAttributesPerSpan,
        this._config.maxEventsPerSpan,
        this._config.maxAttributesPerEvent,
        this._config.maxAttributeValueLength,
        keysBeforeHook
      )
      return current
    } catch (error) {
      // Covers the hook and everything done to its return value: a frozen or
      // hostile record must not throw out of `end()` into application code.
      this._logger.debug('beforeSpanSend failed; dropping the span rather than exporting it unscrubbed', error)
      this._recordDrop(1, 'beforeSpanSend failed')
      return null
    }
  }

  /**
   * Restores the fields a hook must not change. Runs per hook so a later hook in
   * the chain cannot sample on an id an earlier one forged.
   */
  private _keepSpanIdentity(hooked: HookSpanRecord, original: SpanIdentity): HookSpanRecord {
    if (
      hooked.traceId !== original.traceId ||
      hooked.spanId !== original.spanId ||
      hooked.parentSpanId !== original.parentSpanId
    ) {
      this._logger.debug('beforeSpanSend changed a span identity field; keeping the original ids')
    }
    // Only the fields that actually differ are written back. Assigning a value
    // to a frozen property throws even when it is the value already there, and
    // a hook that freezes the record it returns would otherwise drop every span.
    // Best-effort, for the next hook in the chain only: the record this builds
    // is not what gets exported. A frozen return refuses every write, and the
    // span must survive that.
    try {
      restoreField(hooked, 'traceId', original.traceId)
      restoreField(hooked, 'spanId', original.spanId)
      restoreField(hooked, 'parentSpanId', original.parentSpanId)
      // A hook that rebuilds the record instead of spreading it would otherwise
      // drop tracestate, which is not part of the record the hook is handed.
      restoreField(hooked, 'traceState', original.traceState)
    } catch {
      // Frozen, so the writes above were refused and this record still carries
      // whatever identity the hook forged. The export reads the snapshot either
      // way, but the next hook in the chain reads this — and would sample or
      // route on a forged id, which identity immutability exists to prevent.
      return withRestoredIdentity(hooked, original)
    }
    return hooked
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

  /**
   * Discards the queue when consent has been withdrawn, returning how many spans
   * it dropped. Spans carry `posthogDistinctId` and `sessionId`, so anything still
   * queued when the user opts out must not be exported.
   */
  private _discardQueueIfConsentWithdrawn(): number {
    if (!this._instance.isDisabled && !this._instance.optedOut) {
      return 0
    }
    const discarded = this._queue.length
    this._queue = []
    this._recordDrop(discarded, 'the user has opted out')
    this._warnAboutDrops()
    return discarded
  }

  /** Returns how many spans it removed from the queue, sent or dropped. */
  private async _flushInner(): Promise<number> {
    if (!this._queue.length) {
      return 0
    }

    const discardedBeforeDrain = this._discardQueueIfConsentWithdrawn()
    if (discardedBeforeDrain) {
      return discardedBeforeDrain
    }

    // Bounded like span attributes: resource attributes are caller-supplied too,
    // and they ride on every batch rather than on one span.
    const resourceAttributes = truncateAttributes(
      buildTracesResourceAttributes(this._config, this._instance.getLibraryId(), this._instance.getLibraryVersion()),
      this._config.maxAttributeValueLength
    )
    const scopeName = this._instance.getLibraryId()
    const scopeVersion = this._instance.getLibraryVersion()

    // Bounded by queue depth at flush start, so mid-drain arrivals ride the next flush.
    let remaining = this._queue.length
    let removed = 0
    const generation = this._generation

    try {
      while (remaining > 0 && this._queue.length > 0) {
        // Re-checked per batch: a send suspends, so the user can opt out while one
        // batch is in flight and the batches behind it would still export.
        const discardedMidDrain = this._discardQueueIfConsentWithdrawn()
        if (discardedMidDrain) {
          return removed + discardedMidDrain
        }

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
            this._recordDrop(1, 'the ingestion endpoint rejected it as too large')
            this._consecutiveFlushFailures = 0
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
        this._consecutiveFlushFailures = 0
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
        this._armFlushTimerIfQueued()
      })
  }

  private _armFlushTimerIfQueued(): void {
    if (this._flushTimer || !this._queue.length) {
      return
    }
    this._flushTimer = safeSetTimeout(() => {
      this._flushTimer = undefined
      this._flushInBackground()
    }, this._nextFlushDelay())
  }

  // Retry delay: base interval, doubling, capped at 30s — never below an interval
  // a host configured above the cap.
  private _nextFlushDelay(): number {
    const exponent = Math.min(Math.max(0, this._consecutiveFlushFailures - 1), MAX_FLUSH_BACKOFF_EXPONENT)
    const delay = this._config.flushIntervalMs * 2 ** exponent
    return Math.min(delay, Math.max(MAX_FLUSH_BACKOFF_MS, this._config.flushIntervalMs))
  }

  private _clearFlushTimer(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer)
      this._flushTimer = undefined
    }
  }
}
