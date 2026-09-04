import type { Span, SpanAttributes, SpanAttributeValue, SpanKind, SpanStatusCode, SpanTimeInput } from '@posthog/types'
import type { Logger } from '../types'
import type { SpanContextManager, SpanEventRecord, SpanRecord } from './types'
import { formatTraceparent, normalizeTraceparent, sanitizeTracestate, TRACE_FLAGS_SAMPLED } from './traceparent'
import { clampEndTime, resolveSuppliedTime, sanitizeName } from './sanitize'
import { isArray, isError, isNullish } from '../utils'
import {
  CIRCULAR_VALUE,
  MAX_JSON_SAFE_VALUE_DEPTH,
  MAX_JSON_SAFE_VALUE_ITEMS,
  MAX_JSON_SAFE_VALUE_NODES,
  UNSERIALIZABLE_VALUE,
  assignUserAttributes,
} from '../utils/json-utils'

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
  /** Keys the SDK attached itself. Exempt from the attribute cap and never evicted. */
  autoAttributeKeys: string[]
  maxAttributes: number
  maxEvents: number
  maxAttributesPerEvent: number
  maxAttributeValueLength: number
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
  private readonly _autoKeys: Set<string>
  private readonly _maxAttributes: number
  private readonly _maxEvents: number
  private readonly _maxAttributesPerEvent: number
  private readonly _maxAttributeValueLength: number
  private _userAttributeCount = 0
  private _userEventCount = 0
  private _droppedAttributes = 0
  private _droppedEvents = 0

  constructor(
    init: SpanInit,
    private readonly _onEnd: (record: SpanRecord, autoKeys: ReadonlySet<string>) => void,
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
    this._autoKeys = new Set(init.autoAttributeKeys)
    this._maxAttributes = init.maxAttributes
    this._maxEvents = init.maxEvents
    this._maxAttributesPerEvent = init.maxAttributesPerEvent
    this._maxAttributeValueLength = init.maxAttributeValueLength
    // Null-prototype: a `__proto__` key would otherwise swap this object's prototype
    // instead of becoming an entry, and `toString` and friends would read as
    // already-present.
    this._attributes = Object.create(null) as SpanAttributes
    // Object.keys, not for...in: the latter walks the prototype chain, so a
    // polluted `Object.prototype` key would become an attribute of every span.
    for (const key of Object.keys(init.attributes)) {
      this._writeAttribute(key, init.attributes[key])
    }
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

  /**
   * Writes an attribute unless the span is already at its user-attribute cap.
   *
   * Overwriting a key already on the span always succeeds — the cap counts
   * distinct user keys, not writes — and SDK-attached keys never count toward
   * it, so a span at the cap still carries its person and session ids.
   */
  private _writeAttribute(key: string, value: SpanAttributeValue): void {
    // Nullish removes the key rather than occupying it: storing one would spend no
    // budget and make every later write to that key free, exceeding the cap.
    if (isNullish(value)) {
      if (key in this._attributes && !this._autoKeys.has(key)) {
        this._userAttributeCount--
      }
      delete this._attributes[key]
      return
    }
    // The cap is checked before the value is bounded: walking a value the span is
    // about to drop is the dominant cost of a span that overflows its cap.
    if (!this._autoKeys.has(key) && !(key in this._attributes)) {
      if (this._userAttributeCount >= this._maxAttributes) {
        this._droppedAttributes++
        return
      }
      this._userAttributeCount++
    }
    this._attributes[key] = truncateAttributeValue(value, this._maxAttributeValueLength)
  }

  setAttribute(key: string, value: SpanAttributeValue): this {
    if (this._mutable('setAttribute')) {
      this._writeAttribute(key, value)
    }
    return this
  }

  setAttributes(attributes: SpanAttributes): this {
    if (this._mutable('setAttributes')) {
      // Read through the shared guard first — own enumerable keys only, and a
      // throwing getter costs its own key — then write each through the cap.
      const safe: SpanAttributes = assignUserAttributes({}, attributes)
      for (const key of Object.keys(safe)) {
        this._writeAttribute(key, safe[key])
      }
    }
    return this
  }

  addEvent(name: string, attributes?: SpanAttributes, timestamp?: SpanTimeInput): this {
    if (this._mutable('addEvent')) {
      // An exception the SDK records spends an ordinary slot like any other
      // event. A span that fills its events and then throws therefore keeps its
      // `error` status but loses the exception detail, which `droppedEventsCount`
      // reports — enough to find the case in production if it turns out to occur.
      if (this._userEventCount >= this._maxEvents) {
        this._droppedEvents++
        return this
      }
      this._userEventCount++
      // Copied so a caller reusing one object across events can't mutate a recorded one.
      const bounded =
        attributes && boundAttributes(attributes, this._maxAttributesPerEvent, this._maxAttributeValueLength)
      this._events.push({
        name: sanitizeName(name, 'Span event name', this._maxAttributeValueLength, this._logger),
        timestamp: resolveSuppliedTime(timestamp, this._now(), 'event timestamp', this._logger),
        ...(bounded && {
          attributes: bounded.attributes,
          ...(bounded.dropped && { droppedAttributesCount: bounded.dropped }),
        }),
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
      // Bounded like an attribute value: a status message is one more string the
      // caller controls, and one large enough takes the span past the body limit.
      this._status = {
        code: status,
        ...(message && { message: truncateString(message, this._maxAttributeValueLength) }),
      }
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
    const { type, message, stack } = describeError(error)
    this.addEvent(EXCEPTION_EVENT_NAME, {
      'exception.type': type,
      'exception.message': message,
      ...(stack && { 'exception.stacktrace': stack }),
    })
    // recordException is itself an explicit call, so it follows last-write-wins
    // rather than deferring to an earlier `ok`.
    return this.setStatus('error', message)
  }

  updateName(name: string): this {
    if (this._mutable('updateName')) {
      this._name = sanitizeName(name, 'Span name', this._maxAttributeValueLength, this._logger)
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

    this._onEnd(
      {
        traceId: this._traceId,
        spanId: this._spanId,
        ...(this._parentSpanId && { parentSpanId: this._parentSpanId }),
        ...(this._traceState && { traceState: this._traceState }),
        traceFlags: this._traceFlags,
        parentIsRemote: this._parentIsRemote,
        name: this._name,
        kind: this._kind,
        ...(this._status && { status: this._status }),
        // Copied out with an ordinary prototype: the store is null-prototype, but a
        // record handed to user code should behave like a normal object.
        attributes: { ...this._attributes },
        events: this._events,
        startTime: this._startTime,
        endTime: clampEndTime(resolved, this._startTime),
        ...(this._droppedAttributes && { droppedAttributesCount: this._droppedAttributes }),
        ...(this._droppedEvents && { droppedEventsCount: this._droppedEvents }),
      },
      this._autoKeys
    )
  }
}

const EXCEPTION_EVENT_NAME = 'exception'

/** A value as its string form, or the encoder's marker when it refuses to produce one. */
function safeString(value: unknown): string {
  try {
    return typeof value === 'string' ? value : String(value)
  } catch {
    return UNSERIALIZABLE_VALUE
  }
}

/** A caller-visible counter read back as a number, or 0 for anything else. */
export function nonNegativeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * Re-applies the per-span caps to a record a `beforeSpanSend` hook has already
 * seen. The hook writes to the plain record, not through the span's own guarded
 * writer, so an enriching hook would otherwise push a span past the cap it was
 * trimmed to and back into the 413 path the cap exists to avoid.
 *
 * Earliest-set entries win, matching the span-side rule; SDK-attached keys are
 * exempt. Counts add to whatever the span already dropped.
 */
/**
 * The record's keys with the ones the span itself set first, in that order.
 *
 * `Object.keys` hoists integer-like keys to the front whatever the write order,
 * so a hook adding `attributes['0']` would otherwise outrank an attribute the
 * caller set before the hook ran — and the cap is documented as earliest-set-wins.
 */
function orderedKeys(attributes: SpanAttributes, keysBeforeHook: readonly string[]): string[] {
  if (!keysBeforeHook.length) {
    return Object.keys(attributes)
  }
  // The encoder's own predicate: `in` would walk the prototype chain, so a key
  // the caller set that collides with Object.prototype survives the hook deleting
  // it and reads back as the inherited member, and `hasOwnProperty` would keep a
  // key the hook hid by making it non-enumerable, which the encoder never emits.
  const beforeHook = keysBeforeHook.filter((key) => Object.prototype.propertyIsEnumerable.call(attributes, key))
  const seen = new Set(beforeHook)
  return [...beforeHook, ...Object.keys(attributes).filter((key) => !seen.has(key))]
}

export function applySpanLimits(
  record: SpanRecord,
  autoKeys: ReadonlySet<string>,
  maxAttributes: number,
  maxEvents: number,
  maxAttributesPerEvent: number,
  maxAttributeValueLength: number,
  keysBeforeHook: readonly string[] = []
): void {
  let kept = 0
  let droppedAttributes = 0
  // Built fresh rather than edited in place: a hook is free to return a record
  // whose attributes it froze, and a `delete` on one throws.
  const attributes: SpanAttributes = {}
  for (const key of orderedKeys(record.attributes, keysBeforeHook)) {
    const value = record.attributes[key]
    // Matches `_writeAttribute`: the encoder drops these, so a hook that blanks a
    // value rather than deleting the key must not evict a real attribute.
    if (isNullish(value)) {
      continue
    }
    if (!autoKeys.has(key)) {
      if (kept >= maxAttributes) {
        droppedAttributes++
        continue
      }
      kept++
    }
    Object.defineProperty(attributes, key, {
      value: truncateAttributeValue(value, maxAttributeValueLength),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  record.attributes = attributes
  if (droppedAttributes) {
    // Coerced, not trusted: a hook can put anything in the counter, and a
    // non-number there would erase the count the span itself accumulated.
    record.droppedAttributesCount = nonNegativeCount(record.droppedAttributesCount) + droppedAttributes
  }

  // Walked rather than sliced: a hook can append events or rewrite their
  // attributes, neither of which goes through `addEvent`, so each one still
  // needs its attributes bounded on the way past.
  let keptEvents = 0
  let droppedEvents = 0
  const events: SpanEventRecord[] = []
  for (const event of record.events) {
    if (keptEvents >= maxEvents) {
      droppedEvents++
      continue
    }
    keptEvents++
    if (event.attributes) {
      // A hook can widen an event as freely as it can add one, and neither goes
      // through `addEvent`.
      const bounded = boundAttributes(event.attributes, maxAttributesPerEvent, maxAttributeValueLength)
      event.attributes = bounded.attributes
      if (bounded.dropped) {
        event.droppedAttributesCount = nonNegativeCount(event.droppedAttributesCount) + bounded.dropped
      }
    }
    events.push(event)
  }
  record.events = events
  if (droppedEvents) {
    record.droppedEventsCount = nonNegativeCount(record.droppedEventsCount) + droppedEvents
  }
  if (record.status?.message) {
    // Coerced first: a non-string would reach the encoder to be stringified at
    // full length. Guarded, because a throwing `toString` here would cost the
    // span, where the encoder downstream only marks the field.
    record.status = {
      ...record.status,
      message: truncateString(safeString(record.status.message), maxAttributeValueLength),
    }
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
 * The `stack` of whatever was thrown, as OTel's `exception.stacktrace`. Reads
 * the property behind its own guard: a getter on a hostile object throws, and a
 * thrown string has no stack at all. The value is bounded like any other
 * attribute, by `maxAttributeValueLength`.
 */
function readStack(error: unknown): { stack?: string } {
  try {
    const stack = (error as { stack?: unknown }).stack
    return typeof stack === 'string' && stack ? { stack } : {}
  } catch {
    return {}
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
 * The same depth, node and item caps `encodeAnyValue` uses, but spent per
 * attribute rather than per bag: the encoder allocates one budget for a whole
 * attribute map, this walk allocates one per value. That makes the encoder's
 * budget the stricter of the two — whatever this walk hands back unbounded, the
 * encoder has already stopped short of — at the cost of a wide span paying for
 * a walk whose results the encoder then discards.
 */
interface TruncateState {
  /** Containers on the current path, so a back-reference stops the walk. */
  ancestors: WeakSet<object>
  remainingNodes: number
}

/**
 * Bounds every string reachable from an attribute value to `maxLength`
 * characters, including the strings nested inside arrays and objects. Numbers
 * and booleans are bounded already.
 *
 * An unbounded value is the one thing the per-span caps do not stop: a single
 * multi-MB attribute makes the whole span too large for the ingestion endpoint,
 * and the 413 path then drops that span whole. `setAttribute('payload', { body })`
 * is the usual way one arrives, so the bound has to reach inside the value.
 *
 * Returns the value it was given when nothing needed shortening, so the common
 * case allocates nothing.
 */
function truncateString(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

export function truncateAttributeValue(value: SpanAttributeValue, maxLength: number): SpanAttributeValue {
  return truncateValue(value, maxLength, { ancestors: new WeakSet(), remainingNodes: MAX_JSON_SAFE_VALUE_NODES }, 0)
}

/**
 * Walks under the same depth cap, node budget and ancestor set as
 * `encodeAnyValue`, charging the same values. The encoder spends one budget
 * across the whole attribute bag where this spends one per value, so it runs out
 * no later and marks whatever this walk returned whole.
 *
 * Depth alone does not bound this: a value whose children point back at their
 * siblings costs `fanout ** depth` visits, which is minutes of synchronous work
 * inside the caller's own `setAttribute` call.
 */
function truncateValue(
  value: SpanAttributeValue,
  maxLength: number,
  state: TruncateState,
  depth: number
): SpanAttributeValue {
  if (value === null || typeof value !== 'object') {
    // Free, as it is in the encoder, which drops a nullish leaf without charging.
    if (isNullish(value)) {
      return value
    }
    // A shared subtree is re-walked once per path reaching it, so a leaf that
    // skips the charge lets one value cost `budget * items` string copies.
    if (state.remainingNodes <= 0) {
      return value
    }
    state.remainingNodes--
    return typeof value === 'string' ? truncateString(value, maxLength) : value
  }
  if (state.ancestors.has(value)) {
    // The marker the encoder would produce, not the value itself. Handing the
    // raw ancestor back puts it inside a *copied* parent, where the encoder's
    // own cycle detection no longer recognises it and walks one more level of
    // its strings at full length.
    return CIRCULAR_VALUE
  }
  if (state.remainingNodes <= 0 || depth >= MAX_JSON_SAFE_VALUE_DEPTH) {
    return value
  }
  state.remainingNodes--
  state.ancestors.add(value)
  try {
    // A Date is emitted by the encoder from its own branch, ahead of any
    // `toJSON` probe, so bounding it here would ship a truncated timestamp
    // rather than a shorter one.
    if (value instanceof Date) {
      return value
    }
    // The representation the value defines for itself is what the encoder puts
    // on the wire, so it is what has to be bounded — a `toJSON` returning a
    // megabyte of text is invisible to a walk over the object's own keys.
    const resolved = resolveToJson(value)
    if (resolved.selfDescribed) {
      // Resolving to nothing is the value's answer. Walking its keys anyway
      // would build a plain object the encoder no longer treats as
      // self-describing, putting the internals of a redacted value on the wire.
      // Stored as the string the encoder builds from that same nullish result
      // rather than as the value itself: the encoder probes `toJSON` a second
      // time, so one that answers `null` here is free to answer with a megabyte
      // there, past the bound this walk exists to apply. Left unbounded like the
      // other markers — nine characters at most, and trimming it to `unde` would
      // only make it unreadable.
      return isNullish(resolved.value)
        ? String(resolved.value)
        : truncateValue(resolved.value, maxLength, state, depth + 1)
    }
    if (isArray(value)) {
      // Only the items the encoder will emit are walked; it stops at the same
      // cap, so bounding the rest is work spent on values that never ship.
      const walked = Math.min(value.length, MAX_JSON_SAFE_VALUE_ITEMS)
      // Accumulated rather than copied from the value: `slice()` reads every
      // element, accessors past the cap included, and one of those throwing
      // would reach the outer catch and cost the whole array its bound.
      const boundedItems: SpanAttributeValue[] = []
      for (let index = 0; index < walked; index++) {
        try {
          boundedItems.push(truncateValue(value[index], maxLength, state, depth + 1))
        } catch {
          // A throwing accessor costs its own item, as it does in the encoder.
          boundedItems.push(UNSERIALIZABLE_VALUE)
        }
      }
      // Carried so the encoder still marks what it cut.
      if (value.length > walked) {
        boundedItems.length = value.length
      }
      return boundedItems
    }
    const bounded: SpanAttributes = {}
    // Counted the way the encoder counts, so the walk stops where its output
    // does: a key it skips costs no slot, and reading past the last one it can
    // emit is getter work on values that never ship.
    let emittable = 0
    for (const key of Object.keys(value)) {
      if (emittable >= MAX_JSON_SAFE_VALUE_ITEMS) {
        break
      }
      let boundedItem: SpanAttributeValue
      try {
        // Read once: re-reading to compare would run a getter a second time.
        boundedItem = truncateValue((value as SpanAttributes)[key], maxLength, state, depth + 1)
      } catch {
        // A throwing accessor costs its own key. Reaching the walk's own catch
        // would abandon the whole value unbounded, which is how a lazy ORM
        // relation next to a large field puts that field on the wire whole.
        boundedItem = UNSERIALIZABLE_VALUE
      }
      if (key && !isNullish(boundedItem)) {
        emittable++
      }
      // defineProperty, not assignment: a nested `__proto__` key would otherwise
      // swap the copy's prototype and vanish.
      Object.defineProperty(bounded, key, {
        value: boundedItem,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return bounded
  } catch {
    // Whatever is left — a hostile `Object.keys`, a `slice` that throws — costs
    // this value its bound rather than the span. Per-key reads are guarded
    // above, so a single bad property does not reach here.
    return value
  } finally {
    // Siblings pointing at the same object are duplication, not a cycle.
    state.ancestors.delete(value)
  }
}

/**
 * The value's own serialized form. `selfDescribed` is false when it defines no
 * `toJSON`, or when reading one throws — both fall through to the plain walk,
 * as they do in the encoder.
 */
function resolveToJson(value: object): { selfDescribed: boolean; value?: SpanAttributeValue } {
  try {
    const toJSON = (value as { toJSON?: unknown }).toJSON
    if (typeof toJSON === 'function') {
      return { selfDescribed: true, value: toJSON.call(value) as SpanAttributeValue }
    }
  } catch {
    // Falls through to the plain walk.
  }
  return { selfDescribed: false }
}

/**
 * A copy of a caller-supplied attribute bag holding at most `max` entries, each
 * value bounded to `maxLength`, plus how many entries were refused.
 *
 * Keys past the cap are never read, so a wide object does not pay for the getters
 * on values that are about to be dropped — the order `_writeAttribute` uses for
 * the same reason.
 */
function boundAttributes(
  source: SpanAttributes,
  max: number,
  maxLength: number
): { attributes: SpanAttributes; dropped: number } {
  let keys: string[]
  try {
    keys = Object.keys(source)
  } catch {
    // A hostile own-keys trap costs the bag, not the event carrying it.
    return { attributes: {}, dropped: 0 }
  }
  const attributes: SpanAttributes = {}
  const kept = Math.min(keys.length, max)
  for (let index = 0; index < kept; index++) {
    const key = keys[index]
    let value: SpanAttributeValue
    try {
      value = truncateAttributeValue(source[key], maxLength)
    } catch {
      // A throwing getter costs its own key, as it does in `assignUserAttributes`.
      value = UNSERIALIZABLE_VALUE
    }
    // defineProperty, not assignment: `attributes['__proto__'] = v` hits the
    // prototype setter and the attribute vanishes.
    Object.defineProperty(attributes, key, { value, enumerable: true, writable: true, configurable: true })
  }
  return { attributes, dropped: keys.length - kept }
}

/** `truncateAttributeValue` across an attribute bag, in place. */
export function truncateAttributes(attributes: SpanAttributes, maxLength: number): SpanAttributes {
  for (const key of Object.keys(attributes)) {
    attributes[key] = truncateAttributeValue(attributes[key], maxLength)
  }
  return attributes
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
export function describeError(error: unknown): { type: string; message: string; stack?: string } {
  try {
    const stack = readStack(error)
    if (isError(error)) {
      return { type: error.name || 'Error', message: error.message || '', ...stack }
    }
    if (typeof error === 'string') {
      return { type: 'string', message: error }
    }
    if (error && typeof error === 'object') {
      const maybe = error as { name?: unknown; message?: unknown }
      if (typeof maybe.message === 'string') {
        return { type: typeof maybe.name === 'string' ? maybe.name : 'Object', message: maybe.message, ...stack }
      }
    }
    return { type: typeof error, message: String(error) }
  } catch {
    // A hostile `toString` or accessor must not throw a second error: in `withSpan`
    // that would replace the application's error and skip the span's `end()`.
    return { type: typeof error, message: '' }
  }
}
