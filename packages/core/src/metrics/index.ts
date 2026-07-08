import type {
  CaptureMetricOptions,
  MetricAttributes,
  MetricSample,
  MetricType,
  OtlpHistogramDataPoint,
  OtlpMetric,
  OtlpNumberDataPoint,
} from '@posthog/types'
import type { Logger } from '../types'
import { isArray, safeSetTimeout } from '../utils'
import { toOtlpKeyValueList } from '../logs/logs-utils'
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

interface HistogramState {
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
 */
export class PostHogMetrics {
  private _series = new Map<string, SeriesState>()
  private _flushTimer?: ReturnType<typeof safeSetTimeout>
  // Serializes flushes — a manual flush() during an in-flight timer flush
  // queues behind it instead of racing it for the same window.
  private _flushPromise: Promise<void> | null = null
  // One cardinality warning per window, however many series get dropped.
  private _seriesCapWarned = false

  constructor(
    private readonly _instance: MetricsHost,
    private readonly _config: ResolvedPostHogMetricsConfig,
    private readonly _logger: Logger
  ) {}

  count(name: string, value: number = 1, options?: CaptureMetricOptions): void {
    if (value < 0) {
      this._logger.warn(`Dropping count '${name}': counters are monotonic, value must be >= 0`)
      return
    }
    this._capture({ name, type: 'count', value, unit: options?.unit, attributes: options?.attributes })
  }

  gauge(name: string, value: number, options?: CaptureMetricOptions): void {
    this._capture({ name, type: 'gauge', value, unit: options?.unit, attributes: options?.attributes })
  }

  histogram(name: string, value: number, options?: CaptureMetricOptions): void {
    this._capture({ name, type: 'histogram', value, unit: options?.unit, attributes: options?.attributes })
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

  /** Clears the flush timer and drops the current window. */
  reset(): void {
    this._clearFlushTimer()
    this._series = new Map()
    this._flushPromise = null
    this._seriesCapWarned = false
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

    const key = seriesKey(filtered.type, filtered.name, filtered.unit, filtered.attributes)
    let state = this._series.get(key)
    if (!state) {
      if (this._series.size >= this._config.maxSeriesPerFlush) {
        if (!this._seriesCapWarned) {
          this._seriesCapWarned = true
          this._logger.warn(
            `Metric series cap reached (${this._config.maxSeriesPerFlush} per flush window); ` +
              `dropping new series until the next flush. Reduce attribute cardinality.`
          )
        }
        return
      }
      state = {
        name: filtered.name,
        type: filtered.type,
        unit: filtered.unit,
        attributes: filtered.attributes,
        windowStartMs: Date.now(),
      }
      this._series.set(key, state)
    }

    this._fold(state, filtered.value)
    this._armFlushTimer()
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
        if (!state.hist) {
          state.hist = {
            count: 0,
            sum: 0,
            min: value,
            max: value,
            bucketCounts: new Array(DEFAULT_HISTOGRAM_BOUNDS.length + 1).fill(0),
          }
        }
        const hist = state.hist
        hist.count += 1
        hist.sum += value
        hist.min = Math.min(hist.min, value)
        hist.max = Math.max(hist.max, value)
        hist.bucketCounts[bucketIndexFor(value, DEFAULT_HISTOGRAM_BOUNDS)] += 1
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

  private _armFlushTimer(): void {
    if (this._flushTimer) {
      return
    }
    this._flushTimer = safeSetTimeout(() => {
      this._flushTimer = undefined
      this.flush().catch(() => {})
    }, this._config.flushIntervalMs)
  }

  private _clearFlushTimer(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer)
      this._flushTimer = undefined
    }
  }

  private async _doFlush(): Promise<void> {
    if (this._series.size === 0) {
      return
    }

    // Snapshot and reset the window; samples captured while the send is in
    // flight fold into a fresh window instead of the one being sent.
    const window = this._series
    this._series = new Map()
    this._seriesCapWarned = false

    const payload = buildOtlpMetricsPayload(
      this._buildMetrics(window),
      buildMetricsResourceAttributes(this._config, this._instance.getLibraryId(), this._instance.getLibraryVersion()),
      this._instance.getLibraryId(),
      this._instance.getLibraryVersion()
    )

    const outcome = await this._instance._sendMetricsBatch(payload)
    switch (outcome.kind) {
      case 'ok':
        return
      case 'retry-later':
        // Transient failure: merge the unsent window back so the data rides
        // the next flush instead of being lost.
        this._mergeWindowBack(window)
        return
      case 'too-large':
        this._logger.warn('Metrics batch exceeded the server size limit and was dropped')
        return
      case 'fatal':
        this._logger.error('Failed to send metrics batch:', outcome.error)
        return
    }
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

      const attributes = toOtlpKeyValueList(state.attributes ?? {})
      const startNano = msToUnixNano(state.windowStartMs)

      if (state.type === 'count') {
        const dp: OtlpNumberDataPoint = {
          attributes,
          startTimeUnixNano: startNano,
          timeUnixNano: nowNano,
          asDouble: state.total ?? 0,
        }
        metric.sum!.dataPoints.push(dp)
      } else if (state.type === 'gauge') {
        const dp: OtlpNumberDataPoint = {
          attributes,
          timeUnixNano: nowNano,
          asDouble: state.last ?? 0,
        }
        metric.gauge!.dataPoints.push(dp)
      } else if (state.hist) {
        const dp: OtlpHistogramDataPoint = {
          attributes,
          startTimeUnixNano: startNano,
          timeUnixNano: nowNano,
          count: state.hist.count,
          sum: state.hist.sum,
          min: state.hist.min,
          max: state.hist.max,
          bucketCounts: state.hist.bucketCounts,
          explicitBounds: DEFAULT_HISTOGRAM_BOUNDS,
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
        this._series.set(key, old)
        continue
      }
      current.windowStartMs = Math.min(current.windowStartMs, old.windowStartMs)
      switch (current.type) {
        case 'count':
          current.total = (current.total ?? 0) + (old.total ?? 0)
          break
        case 'gauge':
          // The live window's value is newer — keep it.
          break
        case 'histogram':
          if (old.hist) {
            if (!current.hist) {
              current.hist = old.hist
            } else {
              current.hist.count += old.hist.count
              current.hist.sum += old.hist.sum
              current.hist.min = Math.min(current.hist.min, old.hist.min)
              current.hist.max = Math.max(current.hist.max, old.hist.max)
              for (let i = 0; i < current.hist.bucketCounts.length; i++) {
                current.hist.bucketCounts[i] += old.hist.bucketCounts[i]
              }
            }
          }
          break
      }
    }
  }
}

export { buildOtlpMetricsPayload, buildMetricsResourceAttributes, DEFAULT_HISTOGRAM_BOUNDS } from './metrics-utils'
export type { MetricsHost, PostHogMetricsConfig, ResolvedPostHogMetricsConfig, SendMetricsBatchOutcome } from './types'
