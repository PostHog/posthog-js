import type { Span, SpanAttributes, SpanAttributeValue, SpanKind, SpanStatusCode, SpanTimeInput } from '@posthog/types'
import type { Logger } from '../types'
import type { SpanEventRecord, SpanRecord } from './types'
import { formatTraceparent } from './traceparent'
import { clampEndTime, resolveSuppliedTime, sanitizeName } from './sanitize'
import { isError } from '../utils'

/**
 * A monotonic millisecond reading where the platform has one.
 *
 * Durations are measured against this rather than the wall clock so an NTP
 * correction mid-span can't produce a negative duration, and so event
 * timestamps provably land inside the span window.
 */
function monotonicNow(): number | undefined {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance
  return typeof perf?.now === 'function' ? perf.now() : undefined
}

export interface SpanInit {
  traceId: string
  spanId: string
  parentSpanId?: string
  traceState?: string
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
  private readonly _startTime: number
  // Monotonic reading at construction, absent on backdated spans (which use the
  // wall clock throughout) and on platforms with no monotonic source.
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
      this._attributes[key] = value
    }
    return this
  }

  setAttributes(attributes: SpanAttributes): this {
    if (this._mutable('setAttributes')) {
      for (const key in attributes) {
        this._attributes[key] = attributes[key]
      }
    }
    return this
  }

  addEvent(name: string, attributes?: SpanAttributes, timestamp?: SpanTimeInput): this {
    if (this._mutable('addEvent')) {
      this._events.push({
        name: sanitizeName(name, 'Span event name', this._logger),
        timestamp: resolveSuppliedTime(timestamp, this._now(), 'event timestamp', this._logger),
        // Copied so a caller reusing one object across events can't mutate a recorded one.
        ...(attributes && { attributes: { ...attributes } }),
      })
    }
    return this
  }

  setStatus(status: SpanStatusCode, message?: string): this {
    if (this._mutable('setStatus')) {
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
    return formatTraceparent(this._traceId, this._spanId)
  }

  tracestate(): string | null {
    return this._traceState ?? null
  }

  /** Context a child span inherits when this handle is its parent. */
  childContext(): { traceId: string; parentSpanId: string; traceState?: string } {
    return { traceId: this._traceId, parentSpanId: this._spanId, traceState: this._traceState }
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
 * SDK disabled, user opted out.
 *
 * It supports the full surface so caller code never branches, is never
 * activated, and returns `null` from `traceparent()` so an id that was never
 * recorded cannot propagate to another service.
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
  end(): void {
    // Nothing to end.
  }
}

// Typed as `Span`, not `NoopSpan`: the class's methods take no parameters (they
// ignore everything), so the concrete type would reject calls the interface
// allows. Nothing should depend on the concrete class.
export const NOOP_SPAN: Span = new NoopSpan()

/**
 * Extracts the OTel `exception.type` / `exception.message` pair from whatever the
 * application threw. Anything can be thrown in JS, so non-Errors are described
 * by their primitive type rather than dropped.
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
