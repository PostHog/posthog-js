import type { OtlpKeyValue } from './capture-log'

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
     * `exception` event carrying `exception.type`, `exception.message` and,
     * where the thrown value has one, `exception.stacktrace`. The stack is
     * truncated to `maxAttributeValueLength` like any other attribute value,
     * and `beforeSpanSend` sees it before it is exported. Does not end the span.
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
     * This span's W3C `traceparent` header value (`00-<traceId>-<spanId>-<flags>`),
     * for propagating the trace to another service. A span continuing a remote
     * trace propagates the flags byte it was handed, so a downstream sampler
     * sees the decision the head sampler made; a trace started here is sampled.
     *
     * When tracing is off, a span started with a `parent` header echoes that
     * header back — version and sampled flag included — so a service that
     * records nothing still keeps a distributed trace whole. With no `parent`
     * there is no context to carry and this returns `null`, so an id this SDK
     * never recorded cannot propagate.
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
 * A completed span as `beforeSpanSend` sees it: plain values, not the OTLP wire
 * encoding — `userId: 42` reads as `42`, not `{ intValue: "42" }`.
 *
 * @experimental Subject to change in a minor release.
 */
export interface SpanRecord {
    /**
     * Assignment to any of the three identity fields is ignored with a debug
     * warning: rewriting ids orphans children that already shipped.
     */
    readonly traceId: string
    readonly spanId: string
    /** Absent on a root span. */
    readonly parentSpanId?: string
    name: string
    kind: SpanKind
    status?: { code: SpanStatusCode; message?: string }
    /** Editable in place; this is where to redact. */
    attributes: SpanAttributes
    events: { name: string; /** Millisecond epoch. */ timestamp: number; attributes?: SpanAttributes }[]
    /** Millisecond epoch. */
    startTime: number
    /** Millisecond epoch. */
    endTime: number
}

/**
 * Inspects, edits or drops a finished span. Return `null` to drop it.
 *
 * The hook runs synchronously as part of `end()`; a returned promise is not
 * awaited and the span is dropped.
 *
 * @experimental Subject to change in a minor release.
 */
export type BeforeSpanSendFn = (span: SpanRecord) => SpanRecord | null

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
     * Extra OTLP resource attributes attached to every batch.
     *
     * A string `service.name`, `service.version` or `deployment.environment` here
     * wins over the `serviceName` / `serviceVersion` / `environment` fields — set
     * it either way. `telemetry.sdk.*` is SDK-controlled and always wins.
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

    /**
     * Bound on the in-memory export queue. When it is full the incoming span is
     * dropped rather than evicting a queued one, whose children may already have
     * been exported. Never lower than `maxExportBatchSize`.
     *
     * @default 2048
     */
    maxQueueSize?: number

    /**
     * Runs on every finished span before it is queued. Edit the span in place,
     * or return `null` to drop it. An array runs left to right, and the first
     * hook to return `null` stops the chain.
     *
     * This is the place to scrub sensitive attributes, so a hook that throws
     * drops the span rather than exporting an unscrubbed one.
     *
     * @example Drop health checks and redact a header
     * ```ts
     * traces: {
     *   beforeSpanSend: (span) => {
     *     if (span.attributes['http.route'] === '/health') return null
     *     delete span.attributes['http.request.header.authorization']
     *     return span
     *   },
     * }
     * ```
     */
    beforeSpanSend?: BeforeSpanSendFn | BeforeSpanSendFn[]

    /**
     * Maximum user-supplied attributes on a single span. Attributes the SDK
     * attaches itself — `posthogDistinctId`, `sessionId` and friends — are
     * exempt and are never evicted, because they are what links a span to a
     * person and a session.
     *
     * On overflow the earliest-set attributes are kept and later ones are
     * dropped, with the number dropped reported on the exported span.
     *
     * @default 128
     */
    maxAttributesPerSpan?: number

    /**
     * Maximum events on a single span. On overflow the earliest events are kept
     * and later ones are dropped, with the number dropped reported on the
     * exported span.
     *
     * Once the cap is spent, up to four more `exception` events are still
     * accepted, so a span that fills its events and then throws still carries the
     * exception rather than only an `error` status. Below the cap an exception
     * is an ordinary event and spends an ordinary slot.
     *
     * @default 128
     */
    maxEventsPerSpan?: number

    /**
     * Maximum length of a string attribute value. Longer values are truncated,
     * and the bound reaches every string the value contains, including the ones
     * nested inside arrays and objects. It applies to span attributes, event
     * attributes, status messages and resource attributes alike — including
     * `exception.stacktrace`.
     *
     * The bound is what keeps one large value from making a span too large for
     * the ingestion endpoint, which drops an oversized span whole.
     *
     * @default 8192
     */
    maxAttributeValueLength?: number

    /**
     * Bound on how many spans may be live (started but not ended) at once. At
     * the bound `startSpan` returns an inert handle, so code that leaks spans
     * cannot grow the SDK's bookkeeping without limit. The SDK tracks only an
     * id and a timestamp per live span, never the span itself, so a high bound
     * is inexpensive.
     *
     * @default 10000
     */
    maxLiveSpans?: number

    /**
     * How long a span may stay live before the SDK stops accounting for it, in
     * milliseconds. An evicted span is never exported, and its slot is returned
     * so one leak cannot disable tracing for the rest of the process. Measured
     * as monotonic elapsed time since `startSpan`, so a caller-supplied
     * `startTime` neither ages a span early nor exempts it.
     *
     * @default 3600000
     */
    maxSpanAgeMs?: number
}

// ============================================================================
// OTLP wire types
//
// `AnyValue` and `KeyValue` are the same shapes the logs and metrics payloads
// use, and one shared encoder produces all three, so spans alias them rather
// than redeclaring them. The alias names remain so the span types below read as
// span types.
// ============================================================================

export type OtlpSpanKeyValue = OtlpKeyValue

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
    /**
     * W3C trace flags in the low byte — the sampled bit as this span propagates
     * it — plus OTel's parent-remoteness bits (`0x100` known, `0x200` remote).
     */
    flags?: number
    /** User attributes dropped by `maxAttributesPerSpan`. Omitted when none were. */
    droppedAttributesCount?: number
    /** Events dropped by `maxEventsPerSpan`. Omitted when none were. */
    droppedEventsCount?: number
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
