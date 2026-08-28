// The OTLP `AnyValue` encoder, shared by the logs, metrics and traces senders.
//
// Every value here comes from application code, so the encoder's job is to
// produce a payload the ingestion service accepts no matter what it is handed.
// A value the server refuses doesn't fail on its own — it 400s the whole
// request, taking every other record in the batch with it.

import type { OtlpAnyValue, OtlpKeyValue } from '@posthog/types'
import type { Logger } from '../types'
import { isArray, isBoolean, isNull, isNullish, isUndefined } from './type-utils'
import {
  CIRCULAR_VALUE,
  FUNCTION_VALUE,
  MAX_JSON_SAFE_VALUE_DEPTH,
  MAX_JSON_SAFE_VALUE_ITEMS,
  MAX_JSON_SAFE_VALUE_NODES,
  sanitizeString,
  TRUNCATED_VALUE,
  UNSERIALIZABLE_VALUE,
} from './json-utils'

// 2^63 — one past int64 max.
const INT64_RANGE_LIMIT = 9223372036854775808

// The same bound for the bigint branch. A decimal string rather than a `n`
// literal: this module reaches the browser bundle, which compiles to ES5, and
// a bigint literal there is a syntax error rather than a runtime fallback.
const INT64_RANGE_LIMIT_DECIMAL = '9223372036854775808'

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

interface EncodeState {
  /** Containers on the current path, so a back-reference becomes a marker. */
  ancestors: WeakSet<object>
  remainingNodes: number
}

function newState(): EncodeState {
  return { ancestors: new WeakSet(), remainingNodes: MAX_JSON_SAFE_VALUE_NODES }
}

export function toOtlpAnyValue(value: unknown, logger?: Logger): OtlpAnyValue {
  try {
    return encodeAnyValue(value, logger, newState(), 0)
  } catch {
    // Runs inside `captureLog`, the metrics flush and span encoding: an error
    // escaping here surfaces in the caller's own code.
    return { stringValue: UNSERIALIZABLE_VALUE }
  }
}

export function toOtlpKeyValueList(attrs: Record<string, unknown>, logger?: Logger): OtlpKeyValue[] {
  try {
    return encodeKeyValueList(attrs, logger, newState(), 0)
  } catch {
    return []
  }
}

function encodeBigInt(value: bigint, logger: Logger | undefined): OtlpAnyValue {
  const decimal = value.toString()
  const limit = BigInt(INT64_RANGE_LIMIT_DECIMAL)
  if (value >= limit || value < -limit) {
    logger?.debug(`Attribute ${decimal} is outside the int64 range; encoding it as a string`)
    return { stringValue: decimal }
  }
  return { intValue: decimal }
}

function encodeAnyValue(value: unknown, logger: Logger | undefined, state: EncodeState, depth: number): OtlpAnyValue {
  if (state.remainingNodes <= 0) {
    return { stringValue: TRUNCATED_VALUE }
  }
  state.remainingNodes--

  if (isBoolean(value)) {
    return { boolValue: value }
  }
  // Reaching this branch proves BigInt exists, so the limit can be built here
  // rather than at module load.
  if (typeof value === 'bigint') {
    return encodeBigInt(value, logger)
  }
  // typeof, not core's isNumber, which excludes NaN — proto3 JSON distinguishes
  // a non-finite float from an ordinary string.
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { stringValue: String(value) }
    }
    if (Number.isInteger(value)) {
      if (Number.isSafeInteger(value)) {
        return { intValue: String(value) }
      }
      // Past MAX_SAFE_INTEGER only BigInt gives the double's exact decimal:
      // `String(-(2**63))` lands 192 below int64 min, outside the field it is
      // about to be parsed into. Without BigInt the value rides as a string,
      // which is never range-checked.
      if (typeof BigInt === 'undefined') {
        return { stringValue: String(value) }
      }
      const decimal = BigInt(value).toString()
      if (value >= INT64_RANGE_LIMIT || value < -INT64_RANGE_LIMIT) {
        // An out-of-range intValue 400s the whole logs request; on the metrics
        // path it is swallowed server-side and the metric just disappears.
        logger?.debug(`Attribute ${decimal} is outside the int64 range; encoding it as a string`)
        return { stringValue: decimal }
      }
      return { intValue: decimal }
    }
    return { doubleValue: value }
  }
  if (typeof value === 'string') {
    return { stringValue: sanitizeString(value) }
  }
  // `String(value)` would put a function's source text on the wire.
  if (typeof value === 'function') {
    return { stringValue: FUNCTION_VALUE }
  }
  if (typeof value === 'symbol') {
    return { stringValue: String(value) }
  }
  if (typeof value === 'object' && value !== null) {
    if (state.ancestors.has(value)) {
      return { stringValue: CIRCULAR_VALUE }
    }
    if (depth >= MAX_JSON_SAFE_VALUE_DEPTH) {
      return { stringValue: TRUNCATED_VALUE }
    }
    if (value instanceof Date) {
      const time = value.getTime()
      const iso = Number.isFinite(time) ? value.toISOString() : String(value)
      // An overridden toISOString can return a non-string, which the server
      // refuses for the whole request.
      return { stringValue: typeof iso === 'string' ? sanitizeString(iso) : String(iso) }
    }
    // Registered before the toJSON probe: a toJSON returning a structure that
    // references its own object is a cycle like any other.
    state.ancestors.add(value)
    try {
      // The representation a value defines for itself — dayjs, Decimal, an ORM
      // document, and a cross-realm Date that fails the `instanceof` above.
      try {
        const toJSON = (value as { toJSON?: unknown }).toJSON
        if (typeof toJSON === 'function') {
          return encodeAnyValue(toJSON.call(value), logger, state, depth + 1)
        }
      } catch {
        // A throwing toJSON falls through to the plain walk.
      }
      if (isArray(value)) {
        return { arrayValue: { values: encodeArrayValues(value, logger, state, depth + 1) } }
      }
      return {
        kvlistValue: {
          values: encodeKeyValueList(value as Record<string, unknown>, logger, state, depth + 1),
        },
      }
    } finally {
      // Siblings that reference the same object are duplication, not a cycle.
      state.ancestors.delete(value)
    }
  }
  return { stringValue: sanitizeString(String(value)) }
}

function encodeArrayValues(
  values: unknown[],
  logger: Logger | undefined,
  state: EncodeState,
  depth: number
): OtlpAnyValue[] {
  const result: OtlpAnyValue[] = []
  const itemCount = Math.min(values.length, MAX_JSON_SAFE_VALUE_ITEMS)
  let index = 0
  for (; index < itemCount && state.remainingNodes > 0; index++) {
    try {
      const element = index in values ? values[index] : undefined
      // Dropped, as iOS and Android do: proto3 JSON has no null AnyValue, and
      // both `null` and `{}` here are rejected for the whole request.
      if (isNullish(element)) {
        continue
      }
      result.push(encodeAnyValue(element, logger, state, depth))
    } catch {
      result.push({ stringValue: UNSERIALIZABLE_VALUE })
    }
  }
  if (values.length > index) {
    result.push({ stringValue: TRUNCATED_VALUE })
  }
  return result
}

function encodeKeyValueList(
  attrs: Record<string, unknown>,
  logger: Logger | undefined,
  state: EncodeState,
  depth: number
): OtlpKeyValue[] {
  const result: OtlpKeyValue[] = []
  for (const key in attrs) {
    // for...in walks the prototype chain once own keys are exhausted. Skipped
    // rather than broken out of: a proxy can yield keys in any order.
    if (!propertyIsEnumerable.call(attrs, key)) {
      continue
    }
    if (result.length >= MAX_JSON_SAFE_VALUE_ITEMS || state.remainingNodes <= 0) {
      // Reported rather than written into the attributes: a synthetic key would
      // land in the user's own namespace and could collide with a real one.
      logger?.debug('Attributes truncated: the value exceeds the OTLP encoder budget')
      break
    }
    try {
      const value = attrs[key]
      if (isNull(value) || isUndefined(value)) {
        continue
      }
      result.push({ key: sanitizeString(key), value: encodeAnyValue(value, logger, state, depth) })
    } catch {
      // A getter that throws costs its own key, not the whole record.
      result.push({ key: sanitizeString(key), value: { stringValue: UNSERIALIZABLE_VALUE } })
    }
  }
  return result
}
