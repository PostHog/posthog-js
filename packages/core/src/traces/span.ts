import type { Span, SpanAttributes, SpanAttributeValue, SpanKind, SpanStatusCode, SpanTimeInput } from '@posthog/types'
import type { Logger } from '../types'
import type { SpanContextManager, SpanEventRecord, SpanRecord } from './types'
import { formatTraceparent, normalizeTraceparent, sanitizeTracestate, TRACE_FLAGS_SAMPLED } from './traceparent'
import { clampEndTime, resolveSuppliedTime, sanitizeName } from './sanitize'
import { assignUserAttributes } from '../utils/json-utils'
import { isError } from '../utils'

/**
 * A monotonic millisecond reading where the platform has one, so an NTP
 * correction mid-span can't produce a negative duration.
 */
export function monotonicNow(): number | undefined {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance
  return typeof perf?.now === 'function' ? perf.now() : undefined
}

export interface SpanInit {
  traceId: string
  spanId: string
  parentSpanId?: string
  traceState?: string
  /** The trace-flags byte to propagate; the inbound one when continuing a remote trace. */
  traceFlags?: string
  /** True when the parent came from a `traceparent` header rather than a local handle. */
  parentIsRemote?: boolean
  name: string
  kind: SpanKind
  attributes: SpanAttributes
  /** ms epoch. */
  startTime: number
  /** True when the caller supplied an explicit `startTime`. */
  backdated: boolean
}

export class PostHogSpan implements Span {
  private readonly _traceId: string
  private readonly _spanId: string
  private readonly _parentSpanId?: string
  private readonly _traceState?: string
  private readonly _traceFlags: string
  private readonly _parentIsRemote: boolean
  private readonly _startTime: number
  // Absent on backdated spans and on platforms with no monotonic source.
  private readonly _startMono?: number

  private _name: string
  private _kind: SpanKind
  private _attributes: SpanAttributes
  private _events: SpanEventRecord[] = []
  private _status?: { code: SpanStatusCode; message?: string }
  private _ended = false

  constructor(
    init: SpanInit,
    private readonly _onEnd: (record: SpanRecord) => void,
    private readonly _logger?: Logger
  ) {
    this._traceId = init.traceId
    this._spanId = init.spanId
    this._parentSpanId = init.parentSpanId
    this._traceState = init.traceState
    this._traceFlags = init.traceFlags ?? TRACE_FLAGS_SAMPLED
    this._parentIsRemote = init.parentIsRemote ?? false
    this._name = init.name
    this._kind = init.kind
    this._attributes = init.attributes
    this._startTime = init.startTime
    this._startMono = init.backdated ? undefined : monotonicNow()
  }

  /**
   * "Now" on this span's clock basis: start plus monotonic elapsed where we
   * have it, wall clock otherwise.
   */
  private _now(): number {
    if (this._startMono !== undefined) {
      const mono = monotonicNow()
      if (mono !== undefined) {
        return this._startTime + Math.max(0, mono - this._startMono)
      }
    }
    return Date.now()
  }

  /** Guards every mutator: operations after `end()` no-op with a debug warning. */
  private _mutable(operation: string): boolean {
    if (this._ended) {
      this._logger?.debug(`Ignoring ${operation} on a span that has already ended`)
      return false
    }
    return true
  }

  setAttribute(key: string, value: SpanAttributeValue): this {
    if (this._mutable('setAttribute')) {
      Object.defineProperty(this._attributes, key, { value, enumerable: true, writable: true, configurable: true })
    }
    return this
  }

  setAttributes(attributes: SpanAttributes): this {
    if (this._mutable('setAttributes')) {
      assignUserAttributes(this._attributes, attributes)
    }
    return this
  }

  addEvent(name: string, attributes?: SpanAttributes, timestamp?: SpanTimeInput): this {
    if (this._mutable('addEvent')) {
      this._events.push({
        name: sanitizeName(name, 'Span event name', this._logger),
        timestamp: resolveSuppliedTime(timestamp, this._now(), 'event timestamp', this._logger),
        // Copied so a caller reusing one object across events can't mutate a recorded one.
        ...(attributes && { attributes: assignUserAttributes({}, attributes) }),
      })
    }
    return this
  }

  setStatus(status: SpanStatusCode, message?: string): this {
    if (this._mutable('setStatus')) {
      if (status !== 'ok' && status !== 'error') {
        this._logger?.debug(`Ignoring unknown span status "${String(status)}"; expected "ok" or "error"`)
        return this
      }
      this._status = { code: status, ...(message && { message }) }
    }
    return this
  }

  /** True when the caller explicitly marked the span `ok`; `withSpan` treats that as final. */
  get statusIsExplicitlyOk(): boolean {
    return this._status?.code === 'ok'
  }

  recordException(error: unknown): this {
    if (!this._mutable('recordException')) {
      return this
    }
    const { type, message } = describeError(error)
    this.addEvent('exception', {
      'exception.type': type,
      'exception.message': message,
    })
    // recordException is itself an explicit call, so it follows last-write-wins
    // rather than deferring to an earlier `ok`.
    return this.setStatus('error', message)
  }

  updateName(name: string): this {
    if (this._mutable('updateName')) {
      this._name = sanitizeName(name, 'Span name', this._logger)
    }
    return this
  }

  traceparent(): string | null {
    return formatTraceparent(this._traceId, this._spanId, this._traceFlags)
  }

  tracestate(): string | null {
    return this._traceState ?? null
  }

  /** Context a child span inherits when this handle is its parent. */
  childContext(): { traceId: string; parentSpanId: string; traceState?: string; traceFlags: string } {
    return {
      traceId: this._traceId,
      parentSpanId: this._spanId,
      traceState: this._traceState,
      // A child of a continued trace keeps propagating the caller's decision.
      traceFlags: this._traceFlags,
    }
  }

  end(endTime?: SpanTimeInput): void {
    if (this._ended) {
      this._logger?.debug('Ignoring end() on a span that has already ended')
      return
    }
    this._ended = true

    const derived = this._now()
    const resolved = resolveSuppliedTime(endTime, derived, 'end time', this._logger)

    this._onEnd({
      traceId: this._traceId,
      spanId: this._spanId,
      ...(this._parentSpanId && { parentSpanId: this._parentSpanId }),
      ...(this._traceState && { traceState: this._traceState }),
      traceFlags: this._traceFlags,
      parentIsRemote: this._parentIsRemote,
      name: this._name,
      kind: this._kind,
      ...(this._status && { status: this._status }),
      attributes: this._attributes,
      events: this._events,
      startTime: this._startTime,
      endTime: clampEndTime(resolved, this._startTime),
    })
  }
}

/**
 * An inert handle returned whenever tracing cannot run — traces unconfigured,
 * SDK disabled, user opted out. Supports the full surface so caller code never
 * branches, and returns `null` from `traceparent()` so an id this SDK never
 * recorded cannot propagate.
 */
export class NoopSpan implements Span {
  setAttribute(): this {
    return this
  }
  setAttributes(): this {
    return this
  }
  addEvent(): this {
    return this
  }
  setStatus(): this {
    return this
  }
  recordException(): this {
    return this
  }
  updateName(): this {
    return this
  }
  traceparent(): string | null {
    return null
  }
  tracestate(): string | null {
    return null
  }
  end(): void {}
}

// Typed as `Span`, not `NoopSpan`: the class's methods take no parameters, so the
// concrete type would reject calls the interface allows.
export const NOOP_SPAN: Span = /* @__PURE__ */ new NoopSpan()

/**
 * An inert handle that carries an inbound trace context. Records nothing, and
 * echoes the `traceparent` it was handed — including the caller's version and
 * sampled flag — so a service with tracing off still forwards the trace it
 * received rather than severing it. The ids it propagates are the upstream
 * caller's own; this SDK invents none.
 */
export class PassThroughSpan extends NoopSpan {
  constructor(
    private readonly _traceparent: string,
    private readonly _tracestate?: string
  ) {
    super()
  }

  override traceparent(): string {
    return this._traceparent
  }

  override tracestate(): string | null {
    return this._tracestate ?? null
  }
}

/**
 * The handle to return when a span cannot be recorded: a pass-through when the
 * caller supplied a usable `parent` header, the shared no-op otherwise.
 */
export function inertSpan(options?: { parent?: unknown; tracestate?: unknown }): Span {
  const parent = options?.parent
  // A handle parent reports its own context, read behind a guard because a
  // foreign handle's accessor may throw. A no-op reports none and stays a no-op.
  const inbound = typeof parent === 'string' || parent == null ? parent : readHandle(parent, 'traceparent')
  const traceparent = normalizeTraceparent(inbound)
  if (!traceparent) {
    return NOOP_SPAN
  }
  const tracestate =
    typeof parent === 'string' || parent == null ? options?.tracestate : readHandle(parent, 'tracestate')
  return new PassThroughSpan(traceparent, sanitizeTracestate(tracestate))
}

function readHandle(parent: unknown, method: 'traceparent' | 'tracestate'): unknown {
  try {
    const fn = (parent as Span)[method]
    return typeof fn === 'function' ? fn.call(parent) : undefined
  } catch {
    return undefined
  }
}

/**
 * Runs `fn` with `span` active, which every scoped helper does the same way.
 *
 * The shared no-op is never activated, so `getActiveSpan()` inside the callback
 * reads null — callbacks should use the handle they're given. A pass-through
 * handle is activated, so `getActiveSpan()?.traceparent()` still propagates an
 * inbound trace through a service with tracing off.
 */
export function runWithActiveSpan<T>(contextManager: SpanContextManager, span: Span, fn: (span: Span) => T): T {
  return span === NOOP_SPAN ? fn(span) : contextManager.with(span, () => fn(span))
}

/**
 * Extracts the OTel `exception.type` / `exception.message` pair from whatever was
 * thrown. Anything can be thrown in JS, so non-Errors are described by type.
 */
export function describeError(error: unknown): { type: string; message: string } {
  try {
    if (isError(error)) {
      return { type: error.name || 'Error', message: error.message || '' }
    }
    if (typeof error === 'string') {
      return { type: 'string', message: error }
    }
    if (error && typeof error === 'object') {
      const maybe = error as { name?: unknown; message?: unknown }
      if (typeof maybe.message === 'string') {
        return { type: typeof maybe.name === 'string' ? maybe.name : 'Object', message: maybe.message }
      }
    }
    return { type: typeof error, message: String(error) }
  } catch {
    // A hostile `toString` or accessor must not throw a second error: in `withSpan`
    // that would replace the application's error and skip the span's `end()`.
    return { type: typeof error, message: '' }
  }
}
