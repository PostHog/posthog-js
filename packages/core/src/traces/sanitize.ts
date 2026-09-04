// Client-side validity.
//
// The ingestion service 400s the *entire request* when one span fails row
// conversion — a timestamp outside signed 64-bit nanoseconds, say — and a 400 is
// non-retriable, so one bad span destroys every other span in the batch.

import type { Logger } from '../types'
import type { SpanAttributes, SpanTimeInput } from '@posthog/types'

const FALLBACK_SPAN_NAME = 'unknown'

// OTLP declares the timestamp fields `fixed64`, but the service parses them as
// signed 64-bit, so a negative (pre-epoch) value is as invalid as an overflow.
const MAX_TIMESTAMP_MS = 9223372036854 // floor(i64::MAX nanoseconds / 1e6)
const MIN_TIMESTAMP_MS = 0

// The server clamps timestamps more than 24h from receive time to now, keeping
// the original in `$originalTimestamp`.
const DEEP_BACKDATE_WARNING_MS = 24 * 60 * 60 * 1000

/**
 * Span and event names must be non-empty. An empty or non-string name is
 * replaced rather than dropped, so a mis-instrumented call site loses its name,
 * not its span. `label` names what is being sanitized in the warning.
 */
export function sanitizeName(name: unknown, label: string, logger?: Logger): string {
  if (typeof name === 'string' && name.trim()) {
    return name
  }
  logger?.debug(`${label} must be a non-empty string; using "${FALLBACK_SPAN_NAME}"`)
  return FALLBACK_SPAN_NAME
}

/**
 * Normalizes a caller-supplied time to a millisecond epoch.
 *
 * Returns `undefined` for anything unusable — the wrong type, `NaN`, or outside
 * the representable range — leaving the caller to fall back to a derived time.
 */
export function toEpochMs(value: SpanTimeInput | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  let ms: unknown = value
  if (value instanceof Date) {
    try {
      ms = value.getTime()
    } catch {
      // `Object.create(Date.prototype)` passes `instanceof` without a Date slot.
      return undefined
    }
  }
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return undefined
  }
  if (ms < MIN_TIMESTAMP_MS || ms > MAX_TIMESTAMP_MS) {
    return undefined
  }
  return ms
}

/**
 * Resolves a caller-supplied start time, warning when it is deep enough in the
 * past that the server will clamp it.
 */
export function resolveStartTime(value: SpanTimeInput | undefined, now: number, logger?: Logger): number {
  const supplied = toEpochMs(value)
  if (supplied === undefined) {
    if (value !== undefined) {
      logger?.debug('Span startTime is out of range or not a valid time; using the current time')
    }
    return now
  }
  if (now - supplied > DEEP_BACKDATE_WARNING_MS) {
    logger?.debug(
      'Span startTime is more than 24 hours in the past; the server will clamp it to receive time and keep the original in $originalTimestamp'
    )
  } else if (supplied > now) {
    // Warned rather than clamped, matching the deep-backdate rule: the value is
    // the caller's. The duration is what suffers, since the end clamps to it.
    logger?.debug('Span startTime is in the future; the span will export with a zero duration')
  }
  return supplied
}

/**
 * Corrects an end time that precedes its start, producing a zero-duration span
 * rather than a negative one the server would reject.
 */
export function clampEndTime(endTime: number, startTime: number): number {
  return endTime < startTime ? startTime : endTime
}

/**
 * Keeps a caller-supplied end or event time inside the representable range,
 * falling back to the span's own clock basis when it is unusable. `label` names
 * what is being sanitized in the warning.
 */
export function resolveSuppliedTime(
  value: SpanTimeInput | undefined,
  derived: number,
  label: string,
  logger?: Logger
): number {
  const supplied = toEpochMs(value)
  if (supplied === undefined) {
    if (value !== undefined) {
      logger?.debug(`Span ${label} is out of range or not a valid time; using the derived time`)
    }
    return derived
  }
  return supplied
}
