// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

import type { ErrorProperties, Event, StackFrame, McpEvent } from '../types'

// --- Constants ---
export const MAX_DEPTH = 10
export const MAX_BREADTH = 100
export const MAX_STRING_LENGTH = 32_768 // 32KB
export const MAX_EVENT_BYTES = 102_400 // 100KB

// --- Field-level limit constants ---
const MAX_USER_INTENT_LENGTH = 2048
const MAX_ERROR_MESSAGE_LENGTH = 2048
const MAX_RESOURCE_NAME_LENGTH = 256
const MAX_METADATA_LENGTH = 256
const MAX_STACK_FRAMES = 50
const MAX_CONTENT_TEXT_LENGTH = 32_768

// --- Truncation markers ---
const TRUNCATION_SUFFIX = '...'

type MutableEvent = Partial<Event | McpEvent> & Record<string, unknown>
type MutableRecord = Record<string, unknown>

/**
 * Recursively normalizes a value, handling:
 * - String truncation (> MAX_STRING_LENGTH)
 * - Non-serializable values (functions, symbols, undefined, BigInt, NaN, Infinity)
 * - Date objects -> ISO string
 * - Circular reference detection
 * - Depth limiting
 * - Breadth limiting
 */
export function normalize(
  input: unknown,
  depth: number = MAX_DEPTH,
  maxBreadth: number = MAX_BREADTH,
  maxStringLength: number = MAX_STRING_LENGTH
): unknown {
  const memo = new WeakSet<object>()
  return visit(input, depth, maxBreadth, maxStringLength, memo)
}

function visit(
  value: unknown,
  remainingDepth: number,
  maxBreadth: number,
  maxStringLength: number,
  memo: WeakSet<object>
): unknown {
  // null
  if (value === null) {
    return null
  }

  // undefined
  if (value === undefined) {
    return '[undefined]'
  }

  // boolean
  if (typeof value === 'boolean') {
    return value
  }

  // number (including NaN, Infinity)
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return '[NaN]'
    }
    if (!Number.isFinite(value)) {
      return value > 0 ? '[Infinity]' : '[-Infinity]'
    }
    return value
  }

  // bigint
  if (typeof value === 'bigint') {
    return `[BigInt: ${value}]`
  }

  // string
  if (typeof value === 'string') {
    if (value.length > maxStringLength) {
      return value.slice(0, maxStringLength) + TRUNCATION_SUFFIX
    }
    return value
  }

  // symbol
  if (typeof value === 'symbol') {
    const desc = value.description
    return desc ? `[Symbol(${desc})]` : '[Symbol()]'
  }

  // function
  if (typeof value === 'function') {
    const name = value.name || '<anonymous>'
    return `[Function: ${name}]`
  }

  // Date
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString()
  }

  // Objects and arrays from here — need depth/breadth/circular checks
  if (typeof value === 'object') {
    // Circular reference detection
    if (memo.has(value)) {
      return '[Circular ~]'
    }

    // Depth limit
    if (remainingDepth <= 0) {
      return Array.isArray(value) ? '[Array]' : '[Object]'
    }

    memo.add(value)

    let result: unknown
    if (Array.isArray(value)) {
      result = visitArray(value, remainingDepth - 1, maxBreadth, maxStringLength, memo)
    } else {
      result = visitObject(value as Record<string, unknown>, remainingDepth - 1, maxBreadth, maxStringLength, memo)
    }

    memo.delete(value)
    return result
  }

  // Fallback: coerce to string
  return String(value)
}

function visitArray(
  arr: unknown[],
  remainingDepth: number,
  maxBreadth: number,
  maxStringLength: number,
  memo: WeakSet<object>
): unknown[] {
  const result: unknown[] = []
  for (let i = 0; i < arr.length; i++) {
    if (i >= maxBreadth) {
      result.push('[MaxProperties ~]')
      break
    }
    result.push(visit(arr[i], remainingDepth, maxBreadth, maxStringLength, memo))
  }
  return result
}

function visitObject(
  obj: Record<string, unknown>,
  remainingDepth: number,
  maxBreadth: number,
  maxStringLength: number,
  memo: WeakSet<object>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const keys = Object.keys(obj)
  let count = 0

  for (const key of keys) {
    if (count >= maxBreadth) {
      result['...'] = '[MaxProperties ~]'
      break
    }
    // Skip undefined values — matches JSON.stringify behavior (omits undefined properties)
    if (obj[key] === undefined) {
      continue
    }
    result[key] = visit(obj[key], remainingDepth, maxBreadth, maxStringLength, memo)
    count++
  }

  return result
}

// --- Field-level truncation helpers ---

function truncateString(str: string | undefined, maxLength: number): string | undefined {
  if (str == null) {
    return str
  }
  if (str.length <= maxLength) {
    return str
  }
  return str.slice(0, maxLength) + TRUNCATION_SUFFIX
}

function truncateStackFrames(frames: StackFrame[] | undefined): StackFrame[] | undefined {
  if (!frames || frames.length <= MAX_STACK_FRAMES) {
    return frames
  }
  const half = Math.floor(MAX_STACK_FRAMES / 2)
  return [...frames.slice(0, half), ...frames.slice(-half)]
}

/**
 * Bounds an `ErrorProperties` payload: truncates each exception's `value`
 * (message) and caps its stack frames. Operates on the core `$exception_list`
 * shape produced by `captureException`.
 */
function truncateExceptionList(error: ErrorProperties): ErrorProperties {
  if (!Array.isArray(error.$exception_list)) {
    return error
  }
  return {
    ...error,
    $exception_list: error.$exception_list.map((exception) => {
      const next = { ...exception }
      if (typeof next.value === 'string') {
        next.value = truncateString(next.value, MAX_ERROR_MESSAGE_LENGTH)
      }
      if (next.stacktrace?.frames) {
        next.stacktrace = { ...next.stacktrace, frames: truncateStackFrames(next.stacktrace.frames) }
      }
      return next
    }),
  }
}

function truncateResponseContent(response: unknown): unknown {
  if (response == null || typeof response !== 'object') {
    return response
  }
  const result: MutableRecord = { ...(response as MutableRecord) }
  if (Array.isArray(result.content)) {
    result.content = result.content.map((block: unknown) => {
      if (
        block != null &&
        typeof block === 'object' &&
        'type' in block &&
        'text' in block &&
        block?.type === 'text' &&
        typeof block.text === 'string' &&
        block.text.length > MAX_CONTENT_TEXT_LENGTH
      ) {
        return {
          ...(block as MutableRecord),
          text: block.text.slice(0, MAX_CONTENT_TEXT_LENGTH) + TRUNCATION_SUFFIX,
        }
      }
      return block
    })
  }
  return result
}

/**
 * Calculates the UTF-8 byte size of a JSON-serialized value.
 */
const textEncoder = new TextEncoder()

function jsonByteSize(value: unknown): number {
  return textEncoder.encode(JSON.stringify(value)).length
}

/**
 * Finds and truncates the largest string values in an object to fit within a byte budget.
 * Last-resort mechanism when depth reduction alone isn't enough.
 * Iterates until the result fits or no further reduction is possible.
 */
function truncateLargestFields<T>(obj: T, maxBytes: number): T {
  const result = structuredClone(obj)

  for (let attempt = 0; attempt < 10; attempt++) {
    const currentSize = jsonByteSize(result)
    if (currentSize <= maxBytes) {
      return result
    }

    const excess = currentSize - maxBytes

    // Find all string values and their sizes, sorted largest first
    const stringPaths: Array<{ path: string[]; length: number }> = []
    collectStringPaths(result, [], stringPaths)
    stringPaths.sort((a, b) => b.length - a.length)

    if (stringPaths.length === 0) {
      break // no strings left to truncate
    }

    // Distribute the reduction across the largest strings
    let remaining = excess + 200 // buffer for JSON overhead from added "..." suffixes
    let truncated = false

    for (const { path, length } of stringPaths) {
      if (remaining <= 0) {
        break
      }
      const reduction = Math.min(remaining, Math.floor(length * 0.5))
      if (reduction < 10) {
        continue // not worth truncating tiny strings
      }
      const newLength = length - reduction
      const currentValue = getNestedValue(result, path)
      if (typeof currentValue !== 'string') {
        continue
      }
      setNestedValue(result, path, currentValue.slice(0, newLength) + TRUNCATION_SUFFIX)
      remaining -= reduction
      truncated = true
    }

    if (!truncated) {
      break // no progress possible
    }
  }

  return result
}

function collectStringPaths(
  obj: unknown,
  currentPath: string[],
  results: Array<{ path: string[]; length: number }>
): void {
  if (typeof obj === 'string' && obj.length > 100) {
    results.push({ path: [...currentPath], length: obj.length })
    return
  }
  if (Array.isArray(obj)) {
    for (const [i, item] of obj.entries()) {
      collectStringPaths(item, [...currentPath, String(i)], results)
    }
    return
  }
  if (obj != null && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      collectStringPaths(value, [...currentPath, key], results)
    }
  }
}

function getNestedValue(obj: unknown, path: string[]): unknown {
  let current: unknown = obj
  for (const key of path) {
    if (current == null || typeof current !== 'object') {
      return
    }
    current = (current as MutableRecord)[key]
  }
  return current
}

function setNestedValue(obj: unknown, path: string[], value: unknown): void {
  let current: unknown = obj
  for (let i = 0; i < path.length - 1; i++) {
    if (current == null || typeof current !== 'object') {
      return
    }
    current = (current as MutableRecord)[path[i]]
  }
  const finalKey = path.at(-1)
  if (finalKey !== undefined && current != null && typeof current === 'object') {
    ;(current as MutableRecord)[finalKey] = value
  }
}

/**
 * Ensures an event fits within MAX_EVENT_BYTES by progressively reducing
 * normalization depth, then truncating largest string fields as a last resort.
 */
function truncateToSize(event: MutableEvent): MutableEvent {
  // Check if already within budget
  if (jsonByteSize(event) <= MAX_EVENT_BYTES) {
    return event
  }

  // Progressive depth reduction
  for (let depth = MAX_DEPTH - 1; depth >= 1; depth--) {
    const reduced: MutableEvent = { ...event }
    if (reduced.parameters != null) {
      reduced.parameters = normalize(reduced.parameters, depth)
    }
    if (reduced.response != null) {
      reduced.response = normalize(reduced.response, depth)
    }
    if (reduced.identifyActorData != null) {
      reduced.identifyActorData = normalize(reduced.identifyActorData, depth) as Event['identifyActorData']
    }
    if (reduced.error != null) {
      reduced.error = normalize(reduced.error, depth) as Event['error']
    }

    if (jsonByteSize(reduced) <= MAX_EVENT_BYTES) {
      return reduced
    }
  }

  // Last resort: truncate largest string fields
  const minimal: MutableEvent = { ...event }
  if (minimal.parameters != null) {
    minimal.parameters = normalize(minimal.parameters, 1)
  }
  if (minimal.response != null) {
    minimal.response = normalize(minimal.response, 1)
  }
  if (minimal.identifyActorData != null) {
    minimal.identifyActorData = normalize(minimal.identifyActorData, 1) as Event['identifyActorData']
  }
  if (minimal.error != null) {
    minimal.error = normalize(minimal.error, 1) as Event['error']
  }

  return truncateLargestFields(minimal, MAX_EVENT_BYTES)
}

/**
 * Applies layered truncation to an event:
 * 1. Field-level string limits (userIntent, resourceName, metadata fields, error.message)
 * 2. Error frame limiting (first 25 + last 25 if > 50)
 * 3. Response content text limits (32KB per text block)
 * 4. Recursive normalization on user-controlled fields
 * 5. Size-targeted truncation (progressive depth reduction + last-resort string truncation)
 */
export function truncateEvent<T extends Event | McpEvent>(event: T): T {
  const result: MutableEvent = { ...event }

  // Layer 1: Field-level string limits
  result.userIntent = truncateString(result.userIntent, MAX_USER_INTENT_LENGTH)
  result.resourceName = truncateString(result.resourceName, MAX_RESOURCE_NAME_LENGTH)
  result.serverName = truncateString(result.serverName, MAX_METADATA_LENGTH)
  result.serverVersion = truncateString(result.serverVersion, MAX_METADATA_LENGTH)
  result.clientName = truncateString(result.clientName, MAX_METADATA_LENGTH)
  result.clientVersion = truncateString(result.clientVersion, MAX_METADATA_LENGTH)

  // Error field limits — operate on the core `$exception_list` shape
  if (result.error != null && typeof result.error === 'object') {
    result.error = truncateExceptionList(result.error as ErrorProperties)
  }

  // Response content text limits
  result.response = truncateResponseContent(result.response)

  // Layer 2: Recursive normalization on user-controlled fields
  if (result.parameters != null) {
    result.parameters = normalize(result.parameters)
  }
  if (result.response != null) {
    result.response = normalize(result.response)
  }
  if (result.identifyActorData != null) {
    result.identifyActorData = normalize(result.identifyActorData) as Event['identifyActorData']
  }
  if (result.error != null) {
    result.error = normalize(result.error) as Event['error']
  }

  // Layer 3: Size-targeted normalization
  return truncateToSize(result) as T
}
