import { JsonType, PostHogEventProperties } from '@posthog/core'

// The payload handed to the native SDK on the fatal path. Native captures it as a
// `$exception` event with `$exception_level: 'fatal'`, which both native SDKs persist to
// disk synchronously before the call returns — that synchronous write is the durability
// this path exists for, so the payload has to stay small and strictly JSON-safe.
//
// Crash-time attribution needs no special handling here: native captures inside the dying
// process, so its own static context (app version, OS, device) is already the crash-time
// context. Only properties native cannot know — the JS exception itself, `$app_state`, the
// Expo update context — travel in this payload.
const FATAL_PAYLOAD_MAX_BYTES = 64 * 1024
// 8 + 44 + 8 KiB of content, leaving ~4 KiB of the 64 KiB cap for keys and structure.
const MAX_PROPERTIES_BYTES = 8 * 1024
const MAX_EXCEPTION_LIST_BYTES = 44 * 1024
const MAX_EXCEPTION_STEPS_BYTES = 8 * 1024
const MAX_EXCEPTION_LIST_ITEMS = 32
const MAX_EXCEPTION_STEPS_ITEMS = 64
const MAX_JSON_DEPTH = 20

const STRING_LIMITS = {
  timestamp: 128,
  distinctId: 1024,
  exceptionLevel: 64,
} as const

const utf8ByteLength = (value: string): number => {
  let bytes = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

const safeJson = (value: unknown): string | null => {
  try {
    const result = JSON.stringify(value)
    return typeof result === 'string' ? result : null
  } catch {
    return null
  }
}

const jsonBytes = (value: unknown): number => {
  const serialized = safeJson(value)
  return serialized === null ? Number.MAX_SAFE_INTEGER : utf8ByteLength(serialized)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isJsonValue = (value: unknown, depth = 0, ancestors: unknown[] = []): value is JsonType => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (depth >= MAX_JSON_DEPTH || typeof value !== 'object') {
    return false
  }
  if (ancestors.includes(value)) {
    return false
  }
  const nextAncestors = [...ancestors, value]
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, depth + 1, nextAncestors))
  }
  return Object.keys(value as Record<string, unknown>).every((key) =>
    isJsonValue((value as Record<string, unknown>)[key], depth + 1, nextAncestors)
  )
}

// Return the longest prefix whose JSON string representation fits. Measure as we scan instead
// of serializing the whole value: fatal-path values can be very large, and JSON escaping means
// a JavaScript string's length is not its serialized UTF-8 size.
const boundedString = (value: string, maxJsonBytes: number): string => {
  let bytes = 2 // surrounding quotes
  let end = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    let nextBytes: number
    let codeUnits = 1
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      nextBytes = 2
    } else if (code <= 0x1f) {
      nextBytes = 6
    } else if (code <= 0x7f) {
      nextBytes = 1
    } else if (code <= 0x7ff) {
      nextBytes = 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        nextBytes = 4
        codeUnits = 2
      } else {
        nextBytes = 6 // JSON.stringify escapes lone surrogates
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      nextBytes = 6
    } else {
      nextBytes = 3
    }
    if (bytes + nextBytes > maxJsonBytes) {
      break
    }
    bytes += nextBytes
    end = index + codeUnits
    index += codeUnits - 1
  }
  return end === value.length ? value : value.slice(0, end)
}

// Values are retained by reference when they fit. This avoids cloning arbitrary customer data
// on the fatal path. Only an oversized string is copied, as a bounded prefix.
const boundedObject = (input: Record<string, unknown>, maxBytes: number): { [key: string]: JsonType } => {
  const output: { [key: string]: JsonType } = {}
  for (const key of Object.keys(input)) {
    const value = input[key]
    if (!isJsonValue(value)) {
      continue
    }
    if (typeof value === 'string') {
      // Work out how much of this string can fit in the object, including its key and commas,
      // without first creating a serialized copy of the potentially unbounded input.
      const valueBudget = maxBytes - jsonBytes(output) - jsonBytes(key) - 1 - (Object.keys(output).length === 0 ? 0 : 1)
      const bounded = boundedString(value, valueBudget)
      if (bounded.length > 0 || value.length === 0) {
        output[key] = bounded
      }
      continue
    }
    output[key] = value
    if (jsonBytes(output) > maxBytes) {
      delete output[key]
    }
  }
  return output
}

const boundedObjectArray = (
  input: ReadonlyArray<Record<string, unknown>>,
  maxItems: number,
  maxBytes: number
): Array<{ [key: string]: JsonType }> => {
  const output: Array<{ [key: string]: JsonType }> = []
  let usedBytes = 2 // []
  for (let index = 0; index < input.length && output.length < maxItems; index++) {
    const commaBytes = output.length === 0 ? 0 : 1
    const remaining = maxBytes - usedBytes - commaBytes
    if (remaining < 2) {
      break
    }
    const item = boundedObject(input[index], remaining)
    const itemBytes = jsonBytes(item)
    if (itemBytes > remaining) {
      break
    }
    output.push(item)
    usedBytes += commaBytes + itemBytes
  }
  return output
}

const asObjectArray = (value: unknown, name: string): Array<Record<string, unknown>> => {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isRecord)) {
    throw new Error(`buildFatalExceptionPayload: ${name} must be a non-empty array of objects`)
  }
  return value
}

export interface FatalExceptionPayload {
  distinctId: string
  timestamp: string
  properties: { [key: string]: JsonType }
}

export interface BuildFatalExceptionPayloadInput {
  timestamp: string
  distinctId: string
  // The full property bag of the `before_send`-accepted event. Everything native cannot
  // reconstruct itself is carried through; conflicting keys are native's to resolve.
  properties: PostHogEventProperties
}

// `$exception_list` and `$exception_steps` get their own budgets: they are the unbounded,
// customer-influenced parts of the payload, and one must not be able to crowd out the rest.
const EXCEPTION_KEYS = new Set(['$exception_list', '$exception_steps'])

// The remaining properties are bounded as one bag, and `boundedObject` fills in key order
// until the budget runs out. An app with a large flag set therefore pushes whatever sorts
// after `$feature/*` off the end — session linkage and release attribution included. These
// keys are written first so a big property bag can only cost bulk properties, never the
// attribution a crash report is useless without.
const PRIORITY_KEYS = [
  '$session_id',
  '$device_id',
  // Consent and identity resolution: native cannot re-derive what JS decided.
  '$process_person_profile',
  '$is_identified',
  '$geoip_disable',
  // Release attribution — what a crash gets triaged by.
  '$app_version',
  '$app_build',
  '$lib',
  '$lib_version',
  // Crash-time context native has no view of.
  '$app_state',
  '$expo_update_id',
  '$expo_runtime_version',
  '$expo_channel',
  '$expo_is_embedded_launch',
] as const
const PRIORITY_KEY_SET = new Set<string>(PRIORITY_KEYS)

// Priority keys first, then everything else in its original order.
const byPriority = (input: Record<string, unknown>): Record<string, unknown> => {
  const ordered: Record<string, unknown> = {}
  for (const key of PRIORITY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      ordered[key] = input[key]
    }
  }
  for (const key of Object.keys(input)) {
    if (!PRIORITY_KEY_SET.has(key)) {
      ordered[key] = input[key]
    }
  }
  return ordered
}

export const buildFatalExceptionPayload = (input: BuildFatalExceptionPayloadInput): FatalExceptionPayload => {
  if (!input.timestamp) {
    throw new Error('buildFatalExceptionPayload: timestamp is required')
  }

  const source = isRecord(input.properties) ? input.properties : {}
  const exceptionList = boundedObjectArray(
    asObjectArray(source.$exception_list, '$exception_list'),
    MAX_EXCEPTION_LIST_ITEMS,
    MAX_EXCEPTION_LIST_BYTES
  )
  if (exceptionList.length === 0) {
    throw new Error('buildFatalExceptionPayload: $exception_list could not be serialized')
  }

  const rest: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    if (!EXCEPTION_KEYS.has(key)) {
      rest[key] = source[key]
    }
  }

  const properties: { [key: string]: JsonType } = boundedObject(byPriority(rest), MAX_PROPERTIES_BYTES)
  properties.$exception_list = exceptionList
  // Native's fatal fast path keys off this exact value; without it the record is queued
  // asynchronously and the process can die before it reaches disk.
  properties.$exception_level = boundedString(
    typeof source.$exception_level === 'string' && source.$exception_level ? source.$exception_level : 'fatal',
    STRING_LIMITS.exceptionLevel
  )

  if (Array.isArray(source.$exception_steps)) {
    const steps = boundedObjectArray(
      (source.$exception_steps as unknown[]).filter(isRecord),
      MAX_EXCEPTION_STEPS_ITEMS,
      MAX_EXCEPTION_STEPS_BYTES
    )
    if (steps.length > 0) {
      properties.$exception_steps = steps
    }
  }

  const payload: FatalExceptionPayload = {
    distinctId: boundedString(input.distinctId || '', STRING_LIMITS.distinctId),
    timestamp: boundedString(input.timestamp, STRING_LIMITS.timestamp),
    properties,
  }

  // The per-field budgets leave headroom for keys and fixed metadata. Keep the total check
  // anyway: it is the invariant the native bridge relies on.
  if (jsonBytes(payload) > FATAL_PAYLOAD_MAX_BYTES) {
    throw new Error('buildFatalExceptionPayload: serialized payload exceeds 64 KiB')
  }
  return payload
}
