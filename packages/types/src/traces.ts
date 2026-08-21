/**
 * Types for the distributed tracing API (`startSpan` / `withSpan` / `getActiveSpan`).
 *
 * Spans are exported as OpenTelemetry-shaped OTLP records to PostHog's tracing
 * endpoint. PostHog does not depend on the OpenTelemetry SDK — these types are the
 * SDK-facing surface, and the OTLP integer enums stay a wire-level concern.
 */

/**
 * What kind of work a span represents. Mirrors the OpenTelemetry span kinds.
 *
 * @default 'internal'
 *
 * @experimental Subject to change in a minor release.
 */
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer'

/**
 * Outcome of the operation a span covers. A span that never has a status set is
 * exported as `unset`, which is not the same as `ok`.
 *
 * @experimental Subject to change in a minor release.
 */
export type SpanStatusCode = 'ok' | 'error'

/**
 * A value that can be attached to a span, span event, or resource.
 *
 * The ingestion service flattens attribute values to strings for storage, so
 * primitives are strongly preferred — nested arrays and objects survive only as
 * serialized strings and cannot be filtered on. `null` and `undefined` drop the key.
 *
 * @experimental Subject to change in a minor release.
 */
export type SpanAttributeValue =
    | string
    | number
    | boolean
    | bigint
    | SpanAttributeValue[]
    | { [key: string]: SpanAttributeValue }
    | null
    | undefined

export type SpanAttributes = Record<string, SpanAttributeValue>

/**
 * A point in time, as a millisecond epoch number or a `Date`.
 *
 * @experimental Subject to change in a minor release.
 */
export type SpanTimeInput = number | Date

/**
 * Options accepted by `startSpan` and `withSpan`.
 *
 * @experimental Subject to change in a minor release.
 */
export interface StartSpanOptions {
    /**
     * What kind of work the span represents.
     *
     * @default 'internal'
     */
    kind?: SpanKind

    /**
     * Attributes to set at span start. User-supplied keys win over the
     * SDK's auto-attached context attributes.
     */
    attributes?: SpanAttributes

    /**
     * Parent of this span: either a span handle, or a raw W3C `traceparent`
     * string to continue a trace started by another service.
     *
     * When omitted the parent is the currently active span, or none. Only
     * handles returned by this SDK are honoured; any other `Span` yields an
     * inert span.
     *
     * @example Continue an inbound trace
     * ```ts
     * posthog.withSpan('POST /checkout', { parent: req.get('traceparent') }, handler)
     * ```
     */
    parent?: Span | string

    /**
     * The W3C `tracestate` value accompanying a `traceparent`-string `parent`.
     * Ignored when `parent` is a span handle — those inherit the parent's
     * tracestate. Preserved opaquely and passed on to children.
     */
    tracestate?: string

    /**
     * Backdate the span's start. Values outside the representable range fall
     * back to the current time; starts more than 24 hours old are warned about,
     * because the server clamps them to receive time.
     */
    startTime?: SpanTimeInput
}

/**
 * A handle to a span in progress.
 *
 * Every method is safe to call at any time, including after `end()` and on
 * no-op handles, so calling code never has to branch on whether tracing is on.
 *
 * @experimental Subject to change in a minor release.
 */
export interface Span {
    /** Set a single attribute. Ignored after `end()`. */
    setAttribute(key: string, value: SpanAttributeValue): this

    /** Merge several attributes at once. Ignored after `end()`. */
    setAttributes(attributes: SpanAttributes): this

    /**
     * Record a timestamped event within the span, e.g. a cache miss or a retry.
     * Defaults to the current time.
     */
    addEvent(name: string, attributes?: SpanAttributes, timestamp?: SpanTimeInput): this

    /**
     * Set the span's outcome. Last write wins.
     *
     * When a `withSpan` callback throws, the SDK sets `error` automatically —
     * unless the callback already set `ok`, which is treated as final.
     */
    setStatus(status: SpanStatusCode, message?: string): this

    /**
     * Record an exception on the span: sets status `error` and attaches an
     * `exception` event carrying `exception.type` and `exception.message`.
     * Does not end the span.
     */
    recordException(error: unknown): this

    /**
     * Replace the span's name. Useful when the low-cardinality name is only
     * known after work begins — a route template resolving mid-request, say.
     *
     * Span names should be low-cardinality operation names (`GET /users/:id`),
     * never interpolated with ids: PostHog aggregates operations by service and
     * name, so variable values belong in attributes.
     */
    updateName(name: string): this

    /**
     * This span's W3C `traceparent` header value (`00-<traceId>-<spanId>-01`),
     * for propagating the trace to another service. Returns `null` on a no-op
     * span, so an id that was never recorded cannot propagate.
     */
    traceparent(): string | null

    /** This span's W3C `tracestate` value, or `null` when it has none. */
    tracestate(): string | null

    /**
     * End the span and queue it for export. Idempotent — later calls no-op.
     *
     * @param endTime - Override the recorded end. Invalid values fall back to
     * the derived end time; an end before the start is corrected to the start.
     */
    end(endTime?: SpanTimeInput): void
}

/**
 * Configuration for distributed tracing, passed as the `traces` client option.
 * Tracing stays off until this object is supplied.
 *
 * @example
 * ```ts
 * const posthog = new PostHog('phc_...', { traces: { serviceName: 'checkout-api' } })
 * ```
 *
 * @experimental Subject to change in a minor release.
 */
export interface TracesConfig {
    /**
     * Name of the service producing these spans, attached as the OTLP
     * `service.name` resource attribute. PostHog groups operations by service
     * and span name, so this is what makes spans attributable.
     *
     * @default 'unknown_service'
     */
    serviceName?: string

    /** Service version, attached as OTLP `service.version`. */
    serviceVersion?: string

    /**
     * Deployment environment (e.g. `'production'`, `'staging'`), attached as
     * OTLP `deployment.environment`.
     */
    environment?: string

    /**
     * Extra OTLP resource attributes attached to every batch. Applied first;
     * SDK-controlled identity keys (`service.*`, `telemetry.sdk.*`) are layered
     * on top so they cannot be clobbered. Use `serviceName` / `serviceVersion` /
     * `environment` to set those.
     */
    resourceAttributes?: SpanAttributes

    /**
     * How often queued spans are flushed, in milliseconds. Spans also flush when
     * the queue reaches `maxExportBatchSize` and on `shutdown()`.
     *
     * @default 5000
     */
    flushIntervalMs?: number

    /**
     * Maximum spans per outbound request, and the queue depth that triggers an
     * immediate flush. On a 413 the SDK halves this, retries the same spans, then
     * ramps back up.
     *
     * @default 512
     */
    maxExportBatchSize?: number
}

// ============================================================================
// OTLP wire types
//
// Deliberately separate from the log OTLP types: `OtlpAnyValue.intValue` is a
// number there, while the proto3 JSON mapping requires int64 fields to be
// strings.
// ============================================================================

export interface OtlpSpanAnyValue {
    stringValue?: string
    /** Stringified int64, per the proto3 JSON mapping. */
    intValue?: string
    doubleValue?: number
    boolValue?: boolean
    arrayValue?: { values: OtlpSpanAnyValue[] }
    kvlistValue?: { values: OtlpSpanKeyValue[] }
}

export interface OtlpSpanKeyValue {
    key: string
    value: OtlpSpanAnyValue
}

export interface OtlpSpanEvent {
    name: string
    timeUnixNano: string
    attributes?: OtlpSpanKeyValue[]
}

export interface OtlpSpanStatus {
    /** unset 0, ok 1, error 2. */
    code: number
    message?: string
}

export interface OtlpSpan {
    /** 32-char lowercase hex. */
    traceId: string
    /** 16-char lowercase hex. */
    spanId: string
    parentSpanId?: string
    traceState?: string
    name: string
    /** unspecified 0, internal 1, server 2, client 3, producer 4, consumer 5. */
    kind: number
    startTimeUnixNano: string
    endTimeUnixNano: string
    attributes?: OtlpSpanKeyValue[]
    events?: OtlpSpanEvent[]
    status?: OtlpSpanStatus
    /** W3C trace flags in the low byte; the sampled bit is always set. */
    flags?: number
}

export interface OtlpTracesPayload {
    resourceSpans: Array<{
        resource: { attributes: OtlpSpanKeyValue[] }
        scopeSpans: Array<{
            scope: { name: string; version?: string }
            spans: OtlpSpan[]
        }>
    }>
}
