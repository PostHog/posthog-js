/**
 * Metric capture types
 */

import type { OtlpKeyValue } from './capture-log'

/**
 * Metric attribute values are restricted to scalars. Every distinct
 * attribute-value combination creates a new metric series, so high-cardinality
 * values (user IDs, request IDs, URLs) must not be used as attributes — put
 * those on logs or events instead.
 */
export type MetricAttributeValue = string | number | boolean

export type MetricAttributes = Record<string, MetricAttributeValue>

export type MetricType = 'count' | 'gauge' | 'histogram'

/** Options accepted by `posthog.metrics.count/gauge/histogram`. */
export interface CaptureMetricOptions {
    /**
     * Unit of the value (e.g. 'ms', 'byte'). Displayed in the Metrics UI and
     * part of the series identity — the same name with two units is two series.
     */
    unit?: string
    /**
     * Low-cardinality dimensions to filter and group by (e.g. route, plan,
     * region). Each distinct combination is its own series.
     */
    attributes?: MetricAttributes
}

/** Options accepted by `posthog.metrics.histogram`. */
export interface HistogramOptions extends CaptureMetricOptions {
    /**
     * Upper bucket boundaries, finite and strictly increasing. A value lands in
     * the first bucket whose boundary is greater than or equal to it, and values
     * above the last boundary land in an overflow bucket. Defaults to the
     * OpenTelemetry defaults `[0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000]`.
     *
     * The first sample of a histogram (name and unit) fixes its bounds until the
     * client resets. A later sample that passes different bounds is recorded in
     * the fixed buckets and logs a warning, once per flush window. A sample with
     * invalid bounds is dropped with a warning. The client fixes the bounds of at
     * most `maxSeriesPerFlush` histograms. Past that limit, the client drops samples
     * of a new histogram that pass bounds other than the defaults, and logs one
     * warning. Each client fixes bounds on its own. PostHog stores one set of
     * bounds per histogram series and reads every client's counts against it.
     * Every client must therefore pass the same bounds for the same histogram.
     */
    bounds?: number[]
}

/**
 * A captured metric as seen by `beforeSend`, before aggregation. Mutating
 * `name`, `value`, `unit`, `attributes`, or `bounds` changes what gets aggregated;
 * returning `null` drops the sample.
 */
export interface MetricSample {
    name: string
    type: MetricType
    value: number
    unit?: string
    attributes?: MetricAttributes
    /** Histogram bucket boundaries. See {@link HistogramOptions.bounds}. Only histograms use them. */
    bounds?: number[]
}

/**
 * Pre-aggregation filter. Return the (possibly transformed) sample to keep
 * it; return `null` to drop it. Configure as a single function or an array
 * forming a left-to-right chain; a `null` from any link drops the sample and
 * a thrown error also drops it (the error is logged).
 *
 * @example Drop debug metrics in production
 * ```ts
 * metrics: { beforeSend: (m) => (m.name.startsWith('debug_') ? null : m) }
 * ```
 */
export type BeforeSendMetricFn = (sample: MetricSample) => MetricSample | null

/**
 * The public `posthog.metrics` API.
 *
 * @example
 * ```ts
 * posthog.metrics.count('orders_created', 1)
 * posthog.metrics.gauge('active_connections', 42)
 * posthog.metrics.histogram('api_latency', 187, { unit: 'ms' })
 * ```
 */
export interface Metrics {
    /** Add to a counter — things that only go up (orders, clicks, API calls). Value defaults to 1. */
    count(name: string, value?: number, options?: CaptureMetricOptions): void
    /** Record the current value of something that goes up and down (queue depth, connections). */
    gauge(name: string, value: number, options?: CaptureMetricOptions): void
    /** Record one observation of a distribution (latency, payload size). */
    histogram(name: string, value: number, options?: HistogramOptions): void
    /** Send everything aggregated so far without waiting for the flush interval. */
    flush(): Promise<void>
}

// ============================================================================
// OTLP wire format types (ExportMetricsServiceRequest, JSON encoding)
// ============================================================================

/** A sampled measurement linked to the span it was recorded in. IDs are lowercase hex. */
export interface OtlpExemplar {
    filteredAttributes: OtlpKeyValue[]
    timeUnixNano: string
    asDouble: number
    traceId: string
    spanId: string
}

export interface OtlpNumberDataPoint {
    attributes: OtlpKeyValue[]
    /** Unix nanos as a decimal string (uint64 doesn't fit in JS Number). */
    timeUnixNano: string
    startTimeUnixNano?: string
    asDouble: number
    exemplars?: OtlpExemplar[]
}

export interface OtlpHistogramDataPoint {
    attributes: OtlpKeyValue[]
    timeUnixNano: string
    startTimeUnixNano: string
    /** Plain JSON numbers, not strings — see the ingest's u64 handling. */
    count: number
    sum: number
    min: number
    max: number
    bucketCounts: number[]
    explicitBounds: number[]
    exemplars?: OtlpExemplar[]
}

/** AGGREGATION_TEMPORALITY_DELTA — each data point covers one flush window. */
export const OTLP_AGGREGATION_TEMPORALITY_DELTA = 1

export interface OtlpMetric {
    name: string
    unit?: string
    sum?: {
        aggregationTemporality: number
        isMonotonic: boolean
        dataPoints: OtlpNumberDataPoint[]
    }
    gauge?: {
        dataPoints: OtlpNumberDataPoint[]
    }
    histogram?: {
        aggregationTemporality: number
        dataPoints: OtlpHistogramDataPoint[]
    }
}

export interface OtlpMetricsPayload {
    resourceMetrics: Array<{
        resource: { attributes: OtlpKeyValue[] }
        scopeMetrics: Array<{
            scope: { name: string; version?: string }
            metrics: OtlpMetric[]
        }>
    }>
}
