import type {
  CaptureMetricOptions,
  HistogramOptions,
  MetricAttributes,
  MetricSample,
  MetricType,
  OtlpExemplar,
  OtlpHistogramDataPoint,
  OtlpMetric,
  OtlpMetricsPayload,
  OtlpNumberDataPoint,
} from '@posthog/types'
import type { Logger } from '../types'
import { isArray } from '../utils'
import { FlushTimer } from '../utils/flush-timer'
import { RetryAfterWindow } from '../utils/retry-after'
import { MAX_FLUSH_BACKOFF_MS, NO_JITTER, backoffDelayMs, drawJitter } from '../utils/backoff'
import { toOtlpKeyValueList } from '../utils/otlp-any-value'
import { TRACE_FLAGS_SAMPLED, parseTraceparent } from '../traces/traceparent'
import {
  DEFAULT_HISTOGRAM_BOUNDS,
  bucketIndexFor,
  buildMetricsResourceAttributes,
  buildOtlpMetricsPayload,
  msToUnixNano,
  seriesKey,
} from './metrics-utils'
import type { MetricsHost, ResolvedPostHogMetricsConfig } from './types'

const OTLP_TEMPORALITY_DELTA = 1

interface ExemplarState {
  traceId: string
  spanId: string
  value: number
  timeMs: number
}

interface HistogramState {
  bounds: number[]
  count: number
  sum: number
  min: number
  max: number
  bucketCounts: number[]
}

/**
 * One aggregated series within the current flush window. Exactly one of
 * `total` (count), `last` (gauge), or `hist` is populated, matching `type`.
 */
interface SeriesState {
  name: string
  type: MetricType
  unit?: string
  attributes?: MetricAttributes
  windowStartMs: number
  total?: number
  last?: number
  hist?: HistogramState
  /** The last sample recorded inside a sampled span this window. */
  exemplar?: ExemplarState
}

/**
 * Statsd-style pre-aggregating metrics client.
 *
 * Samples are folded into per-series aggregates in memory (counts sum,
 * gauges keep the last value, histograms accumulate buckets) and flushed as
 * one OTLP data point per series per window — a burst of 10k `count()` calls
 * costs one data point on the wire. Sums and histograms use delta
 * temporality, so each data point stands alone and client restarts need no
 * cross-window state.
 *
 * Deliberately unlike logs, no per-user context (distinct ID, session ID) is
 * attached: every attribute value creates a new series, and per-user series
 * are the canonical metrics-cardinality explosion.
 *
 * A sample recorded inside a sampled span stamps its series with an exemplar
 * (trace ID, span ID, value). One per series per window, last sample wins, so a
 * metric point links to one representative trace at no cardinality cost.
 */
export class PostHogMetrics {
  private _series = new Map<string, SeriesState>()
  private readonly _flushTimer = new FlushTimer(() =>
    this.flush().catch((e) => {
      this._logger.error('Metrics flush failed:', e)
    })
  )
  // Serializes flushes — a manual flush() during an in-flight timer flush
  // queues behind it instead of racing it for the same window.
  private _flushPromise: Promise<void> | null = null
  // One cardinality warning per window, however many series get dropped.
  private _seriesCapWarned = false
  // Type seen per metric name this window; reusing a name with a different
  // type gets a one-time dev hint. The read path queries by name, so mixing
  // types under one name produces charts that blend both series.
  private _typeByName = new Map<string, MetricType>()
  private _typeCollisionWarned = new Set<string>()
  // Bounds per histogram (name and unit), fixed by its first sample. They
  // outlive the flush window because buckets from two windows with different
  // bounds cannot be merged. Only reset() clears them. The map holds at most
  // maxSeriesPerFlush histograms.
  private _boundsByHistogram = new Map<string, number[]>()
  // Histograms warned about conflicting bounds this window.
  private _boundsConflictWarned = new Set<string>()
  private _boundsCapWarned = false
  private _retryAfter = new RetryAfterWindow()
  private _consecutiveFlushFailures = 0
  private _flushJitter = NO_JITTER
  // Bumped by reset(). A flush that was in flight when reset() ran (e.g. it
  // lost a shutdown race) sees a stale generation when its send settles and
  // discards its window instead of merging it back and re-arming the timer.
  private _generation = 0

  constructor(
    private readonly _instance: MetricsHost,
    private readonly _config: ResolvedPostHogMetricsConfig,
    private readonly _logger: Logger
  ) {}

  count(name: string, value: number = 1, options?: CaptureMetricOptions): void {
    this._capture({ name, type: 'count', value, unit: options?.unit, attributes: options?.attributes })
  }

  gauge(name: string, value: number, options?: CaptureMetricOptions): void {
    this._capture({ name, type: 'gauge', value, unit: options?.unit, attributes: options?.attributes })
  }

  histogram(name: string, value: number, options?: HistogramOptions): void {
    this._capture({
      name,
      type: 'histogram',
      value,
      unit: options?.unit,
      attributes: options?.attributes,
      // The copy keeps a beforeSend that edits the bounds in place from changing the caller's array.
      bounds: isArray(options?.bounds) ? options.bounds.slice() : options?.bounds,
    })
  }

  /** Sends everything aggregated so far without waiting for the flush interval. */
  flush(): Promise<void> {
    const prev = this._flushPromise
    const run = async (): Promise<void> => {
      if (prev) {
        await prev.catch(() => {})
      }
      await this._doFlush()
    }
    const p = run().finally(() => {
      if (this._flushPromise === p) {
        this._flushPromise = null
      }
    })
    this._flushPromise = p
    return p
  }

  /**
   * Synchronously snapshots the current window into an OTLP payload and
   * resets it, bypassing the flush serializer entirely — for unload-time
   * drains where the host must hand the payload to a synchronous transport
   * (sendBeacon) in the same tick. Returns `null` when there is nothing to
   * send. The caller owns delivery; there is no retry for a drained window.
   */
  drainWindow(): OtlpMetricsPayload | null {
    if (this._series.size === 0) {
      return null
    }
    const window = this._series
    this._startWindow()
    return this._buildPayload(window)
  }

  /** Clears the flush timer, drops the current window, and invalidates in-flight flushes. */
  reset(): void {
    this._generation++
    this._retryAfter.reset()
    this._consecutiveFlushFailures = 0
    this._flushJitter = NO_JITTER
    this._flushTimer.clear()
    this._flushPromise = null
    this._startWindow()
    this._boundsByHistogram = new Map()
    this._boundsCapWarned = false
  }

  /** Clears the state that lives for one flush window. */
  private _startWindow(): void {
    this._series = new Map()
    this._seriesCapWarned = false
    this._typeByName = new Map()
    this._typeCollisionWarned = new Set()
    this._boundsConflictWarned = new Set()
  }

  private _capture(sample: MetricSample): void {
    if (this._instance.isDisabled || this._instance.optedOut) {
      return
    }

    const filtered = this._runBeforeSend(sample)
    if (filtered === null) {
      return
    }

    if (!filtered.name || typeof filtered.name !== 'string') {
      this._logger.warn('Dropping metric with empty name')
      return
    }
    if (typeof filtered.value !== 'number' || !Number.isFinite(filtered.value)) {
      this._logger.warn(`Dropping metric '${filtered.name}': value must be a finite number`)
      return
    }
    if (filtered.type !== 'count' && filtered.type !== 'gauge' && filtered.type !== 'histogram') {
      this._logger.warn(`Dropping metric '${filtered.name}': unknown type '${String(filtered.type)}'`)
      return
    }
    // Checked after beforeSend so a hook can't turn a count negative either.
    if (filtered.type === 'count' && filtered.value < 0) {
      this._logger.warn(`Dropping count '${filtered.name}': counters are monotonic, value must be >= 0`)
      return
    }

    // Snapshot: the key is computed from these values, so a caller mutating
    // the object after capture must not change the stored series. Reading and
    // serializing the attributes can throw (BigInt values, throwing
    // getters/proxies) — a malformed sample is dropped, never thrown.
    let attributes: MetricAttributes | undefined
    let key: string
    try {
      attributes = filtered.attributes ? { ...filtered.attributes } : undefined
      key = seriesKey(filtered.type, filtered.name, filtered.unit, attributes)
    } catch (e) {
      this._logger.warn(`Dropping metric '${filtered.name}': attributes could not be serialized`, e)
      return
    }

    let state = this._series.get(key)
    if (!state && !this._admitNewSeries()) {
      return
    }

    let bounds: number[] | undefined
    if (filtered.type === 'histogram') {
      bounds = this._histogramBounds(filtered.name, filtered.unit, filtered.bounds)
      if (!bounds) {
        return
      }
    }

    if (!state) {
      state = {
        name: filtered.name,
        type: filtered.type,
        unit: filtered.unit,
        attributes,
        windowStartMs: Date.now(),
        hist: bounds && emptyHistogram(bounds),
      }
      this._series.set(key, state)
    }

    // Bookkeeping only for admitted samples, so name-cardinality misuse (IDs
    // interpolated into metric names) can't grow this map past the series cap.
    const seenType = this._typeByName.get(filtered.name)
    if (seenType === undefined) {
      this._typeByName.set(filtered.name, filtered.type)
    } else if (seenType !== filtered.type && !this._typeCollisionWarned.has(filtered.name)) {
      this._typeCollisionWarned.add(filtered.name)
      this._logger.warn(
        `Metric name '${filtered.name}' is already used as a ${seenType}; ` +
          `recording it as a ${filtered.type} too will blend both series in charts. Use a distinct name.`
      )
    }

    this._fold(state, filtered.value)
    const traceContext = this._activeTraceContext()
    if (traceContext) {
      state.exemplar = { ...traceContext, value: filtered.value, timeMs: Date.now() }
    }
    this._armFlushTimer()
  }

  /**
   * The sampled span a sample is recorded in. An unsampled span is never
   * exported, so an exemplar pointing at it would link to a missing trace.
   */
  private _activeTraceContext(): { traceId: string; spanId: string } | undefined {
    try {
      const parsed = parseTraceparent(this._instance.getActiveSpan?.()?.traceparent())
      if (parsed && parsed.flags === TRACE_FLAGS_SAMPLED) {
        return { traceId: parsed.traceId, spanId: parsed.spanId }
      }
    } catch {
      // A throwing host never costs the sample itself.
    }
    return undefined
  }

  /**
   * Cardinality gate for adding a series to the live window — warns once per
   * window when the cap is hit. Applied on capture and on merge-back alike.
   */
  private _admitNewSeries(): boolean {
    if (this._series.size < this._config.maxSeriesPerFlush) {
      return true
    }
    if (!this._seriesCapWarned) {
      this._seriesCapWarned = true
      this._logger.warn(
        `Metric series cap reached (${this._config.maxSeriesPerFlush} per flush window); ` +
          `dropping new series until the next flush. Reduce attribute cardinality.`
      )
    }
    return false
  }

  /**
   * The bounds a histogram sample folds into: the ones its histogram already
   * has, or the requested bounds (default when absent) for a new histogram.
   * A histogram past the bounds limit has no map entry and gets only the
   * default bounds. Returns `undefined` when the sample must be dropped.
   */
  private _histogramBounds(
    name: string,
    unit: string | undefined,
    requested: number[] | undefined
  ): number[] | undefined {
    if (requested !== undefined && !isValidBounds(requested)) {
      this._logger.warn(
        `Dropping histogram '${name}': bounds must be a non-empty array of finite, strictly increasing numbers`
      )
      return undefined
    }
    const histogramKey = seriesKey('histogram', name, unit, undefined)
    const fixed = this._boundsByHistogram.get(histogramKey)
    if (fixed) {
      this._warnOnBoundsConflict(name, histogramKey, fixed, requested)
      return fixed
    }
    // The limit keeps histogram names with interpolated IDs from growing the
    // map without bound. The backend stores one set of bounds per series. A
    // histogram that is not in the map therefore sends only the default bounds,
    // and a sample that asks for other bounds is dropped. Otherwise this client
    // could send other bounds than earlier windows or other clients sent.
    if (this._boundsByHistogram.size >= this._config.maxSeriesPerFlush) {
      if (!this._boundsCapWarned) {
        this._boundsCapWarned = true
        this._logger.warn(
          `Histogram bounds limit reached (${this._config.maxSeriesPerFlush} distinct histograms); ` +
            `new histograms that pass custom bounds are dropped. Reduce histogram name cardinality.`
        )
      }
      if (requested && !sameBounds(requested, DEFAULT_HISTOGRAM_BOUNDS)) {
        return undefined
      }
      return DEFAULT_HISTOGRAM_BOUNDS
    }
    const bounds = requested ? requested.slice() : DEFAULT_HISTOGRAM_BOUNDS
    this._boundsByHistogram.set(histogramKey, bounds)
    return bounds
  }

  private _warnOnBoundsConflict(
    name: string,
    histogramKey: string,
    fixed: number[],
    requested: number[] | undefined
  ): void {
    if (sameBounds(fixed, requested ?? DEFAULT_HISTOGRAM_BOUNDS) || this._boundsConflictWarned.has(histogramKey)) {
      return
    }
    this._boundsConflictWarned.add(histogramKey)
    this._logger.warn(
      `Histogram '${name}' already uses the bounds [${fixed.join(', ')}]; ` +
        `samples that pass different bounds are recorded in those buckets.`
    )
  }

  private _fold(state: SeriesState, value: number): void {
    switch (state.type) {
      case 'count':
        state.total = (state.total ?? 0) + value
        break
      case 'gauge':
        state.last = value
        break
      case 'histogram': {
        const hist = state.hist!
        hist.count += 1
        hist.sum += value
        hist.min = Math.min(hist.min, value)
        hist.max = Math.max(hist.max, value)
        hist.bucketCounts[bucketIndexFor(value, hist.bounds)] += 1
        break
      }
    }
  }

  private _runBeforeSend(sample: MetricSample): MetricSample | null {
    const beforeSend = this._config.beforeSend
    if (!beforeSend) {
      return sample
    }
    const fns = isArray(beforeSend) ? beforeSend : [beforeSend]
    let result: MetricSample = sample
    for (const fn of fns) {
      try {
        const next = fn(result)
        if (!next) {
          this._logger.info(`Metric was rejected in beforeSend function`)
          return null
        }
        result = next
      } catch (e) {
        this._logger.error(`Error in beforeSend function for metric:`, e)
        return null
      }
    }
    return result
  }

  // Every capture calls this, so a pending timer is left alone — re-arming on
  // each one would push the flush out for as long as metrics keep arriving.
  private _armFlushTimer(): void {
    if (this._flushTimer.pending) {
      return
    }
    this._flushTimer.arm(this._nextFlushDelay())
  }

  // A floor, not a replacement: the header never retries us sooner than our own
  // backoff would have. The backoff doubles per consecutive failure so a
  // sustained outage is not retried every interval, and the jitter is drawn
  // once per failure so a fleet refused together does not return together.
  private _nextFlushDelay(): number {
    return Math.max(
      backoffDelayMs(
        this._config.flushIntervalMs,
        this._consecutiveFlushFailures,
        this._flushJitter,
        MAX_FLUSH_BACKOFF_MS
      ),
      this._retryAfter.remainingMs()
    )
  }

  private async _doFlush(): Promise<void> {
    // A flush retires the pending timer, so a delay armed for a window this
    // flush may close cannot outlive it.
    this._flushTimer.clear()
    if (this._series.size === 0) {
      return
    }

    // Snapshot and reset the window; samples captured while the send is in
    // flight fold into a fresh window instead of the one being sent.
    const window = this._series
    this._startWindow()

    const generation = this._generation
    const outcome = await this._instance._sendMetricsBatch(this._buildPayload(window))
    if (generation !== this._generation) {
      // reset() ran while the send was in flight — the client was torn down or
      // reconfigured, so this window is dropped whatever the outcome was.
      return
    }
    this._retryAfter.record(outcome)
    // Before any delay is taken from it, so the timer armed below is measured
    // against this outcome rather than the one before it.
    if (outcome.kind === 'retry-later') {
      this._consecutiveFlushFailures++
      this._flushJitter = drawJitter()
    } else {
      this._consecutiveFlushFailures = 0
      this._flushJitter = NO_JITTER
    }
    // Outright, not through the ratchet: a timer a mid-flight capture armed is
    // measured against a window this outcome may just have closed.
    if (this._flushTimer.pending) {
      this._flushTimer.arm(this._nextFlushDelay())
    }
    switch (outcome.kind) {
      case 'ok':
        return
      case 'retry-later':
        // Transient failure: merge the unsent window back so the data rides
        // the next flush instead of being lost — and re-arm the timer, since
        // with no new captures nothing else would schedule that flush.
        this._mergeWindowBack(window)
        this._flushTimer.armNoEarlierThan(this._nextFlushDelay())
        return
      case 'too-large':
        this._logger.warn('Metrics batch exceeded the server size limit and was dropped')
        return
      case 'fatal':
        this._logger.error('Failed to send metrics batch:', outcome.error)
        return
    }
  }

  private _buildPayload(window: Map<string, SeriesState>): OtlpMetricsPayload {
    return buildOtlpMetricsPayload(
      this._buildMetrics(window),
      buildMetricsResourceAttributes(this._config, this._instance.getLibraryId(), this._instance.getLibraryVersion()),
      this._instance.getLibraryId(),
      this._instance.getLibraryVersion()
    )
  }

  /**
   * Groups the window's series into OTLP metric entries — one entry per
   * (type, name, unit), one data point per attribute combination.
   */
  private _buildMetrics(window: Map<string, SeriesState>): OtlpMetric[] {
    const nowNano = msToUnixNano(Date.now())
    const byMetric = new Map<string, OtlpMetric>()

    for (const state of window.values()) {
      const metricKey = seriesKey(state.type, state.name, state.unit, undefined)
      let metric = byMetric.get(metricKey)
      if (!metric) {
        metric = { name: state.name, ...(state.unit && { unit: state.unit }) }
        if (state.type === 'count') {
          metric.sum = { aggregationTemporality: OTLP_TEMPORALITY_DELTA, isMonotonic: true, dataPoints: [] }
        } else if (state.type === 'gauge') {
          metric.gauge = { dataPoints: [] }
        } else {
          metric.histogram = { aggregationTemporality: OTLP_TEMPORALITY_DELTA, dataPoints: [] }
        }
        byMetric.set(metricKey, metric)
      }

      const attributes = toOtlpKeyValueList(state.attributes ?? {}, this._logger)
      const startNano = msToUnixNano(state.windowStartMs)
      const exemplars = toOtlpExemplars(state.exemplar)

      if (state.type === 'count') {
        const dp: OtlpNumberDataPoint = {
          attributes,
          startTimeUnixNano: startNano,
          timeUnixNano: nowNano,
          asDouble: state.total ?? 0,
          ...exemplars,
        }
        metric.sum!.dataPoints.push(dp)
      } else if (state.type === 'gauge') {
        const dp: OtlpNumberDataPoint = {
          attributes,
          timeUnixNano: nowNano,
          asDouble: state.last ?? 0,
          ...exemplars,
        }
        metric.gauge!.dataPoints.push(dp)
      } else {
        const hist = state.hist!
        const dp: OtlpHistogramDataPoint = {
          attributes,
          startTimeUnixNano: startNano,
          timeUnixNano: nowNano,
          count: hist.count,
          sum: hist.sum,
          min: hist.min,
          max: hist.max,
          bucketCounts: hist.bucketCounts,
          explicitBounds: hist.bounds,
          ...exemplars,
        }
        metric.histogram!.dataPoints.push(dp)
      }
    }

    return Array.from(byMetric.values())
  }

  /** Folds an unsent window back into the live one after a transient send failure. */
  private _mergeWindowBack(window: Map<string, SeriesState>): void {
    for (const [key, old] of window) {
      const current = this._series.get(key)
      if (!current) {
        // The cap still applies here: an unbounded merge-back would let a
        // failed flush reintroduce series past maxSeriesPerFlush.
        if (this._admitNewSeries()) {
          this._series.set(key, old)
        }
        continue
      }
      current.windowStartMs = Math.min(current.windowStartMs, old.windowStartMs)
      // The live window's exemplar is newer; the old one only fills a gap.
      current.exemplar = current.exemplar ?? old.exemplar
      switch (current.type) {
        case 'count':
          current.total = (current.total ?? 0) + (old.total ?? 0)
          break
        case 'gauge':
          // The live window's value is newer — keep it.
          break
        case 'histogram': {
          const hist = current.hist!
          const oldHist = old.hist!
          hist.count += oldHist.count
          hist.sum += oldHist.sum
          hist.min = Math.min(hist.min, oldHist.min)
          hist.max = Math.max(hist.max, oldHist.max)
          for (let i = 0; i < hist.bucketCounts.length; i++) {
            hist.bucketCounts[i] += oldHist.bucketCounts[i]
          }
          break
        }
      }
    }
  }
}

function isValidBounds(bounds: unknown): bounds is number[] {
  if (!isArray(bounds) || bounds.length === 0) {
    return false
  }
  for (let i = 0; i < bounds.length; i++) {
    if (!Number.isFinite(bounds[i]) || (i > 0 && bounds[i] <= bounds[i - 1])) {
      return false
    }
  }
  return true
}

function sameBounds(a: number[], b: number[]): boolean {
  if (a === b) {
    return true
  }
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

function emptyHistogram(bounds: number[]): HistogramState {
  return { bounds, count: 0, sum: 0, min: Infinity, max: -Infinity, bucketCounts: new Array(bounds.length + 1).fill(0) }
}

// Spread into the data point, so a point without an exemplar keeps its exact
// pre-exemplar wire shape.
function toOtlpExemplars(exemplar: ExemplarState | undefined): { exemplars?: OtlpExemplar[] } {
  if (!exemplar) {
    return {}
  }
  return {
    exemplars: [
      {
        filteredAttributes: [],
        timeUnixNano: msToUnixNano(exemplar.timeMs),
        asDouble: exemplar.value,
        traceId: exemplar.traceId,
        spanId: exemplar.spanId,
      },
    ],
  }
}

export { buildOtlpMetricsPayload, buildMetricsResourceAttributes, DEFAULT_HISTOGRAM_BOUNDS } from './metrics-utils'
export { resolveMetricsConfig } from './config'
export type { MetricsHost, PostHogMetricsConfig, ResolvedPostHogMetricsConfig, SendMetricsBatchOutcome } from './types'
