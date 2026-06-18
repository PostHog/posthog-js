// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

import type { CliEvent, ErrorProperties, JsonRecord, StackFrame } from '../types'

export const MAX_DEPTH = 10
export const MAX_BREADTH = 100
export const MAX_STRING_LENGTH = 32_768
export const MAX_EVENT_BYTES = 102_400

const MAX_INTENT_LENGTH = 2048
const MAX_NAME_LENGTH = 256
const MAX_FLAGS = 100
const MAX_ERROR_MESSAGE_LENGTH = 2048
const MAX_STACK_FRAMES = 50
const TRUNCATION_SUFFIX = '...'

type MutableRecord = Record<string, unknown>

/**
 * Recursively normalizes a value: truncates long strings, coerces
 * non-serializable values (functions, symbols, undefined, BigInt, NaN/Infinity),
 * stringifies Dates, breaks circular references, and bounds depth + breadth.
 */
export function normalize(
    input: unknown,
    depth: number = MAX_DEPTH,
    maxBreadth: number = MAX_BREADTH,
    maxStringLength: number = MAX_STRING_LENGTH
): unknown {
    return visit(input, depth, maxBreadth, maxStringLength, new WeakSet<object>())
}

function visit(
    value: unknown,
    remainingDepth: number,
    maxBreadth: number,
    maxStringLength: number,
    memo: WeakSet<object>
): unknown {
    if (value === null) {
        return null
    }
    if (value === undefined) {
        return '[undefined]'
    }
    if (typeof value === 'boolean') {
        return value
    }
    if (typeof value === 'number') {
        if (Number.isNaN(value)) {
            return '[NaN]'
        }
        if (!Number.isFinite(value)) {
            return value > 0 ? '[Infinity]' : '[-Infinity]'
        }
        return value
    }
    if (typeof value === 'bigint') {
        return `[BigInt: ${value}]`
    }
    if (typeof value === 'string') {
        return value.length > maxStringLength ? value.slice(0, maxStringLength) + TRUNCATION_SUFFIX : value
    }
    if (typeof value === 'symbol') {
        return value.description ? `[Symbol(${value.description})]` : '[Symbol()]'
    }
    if (typeof value === 'function') {
        return `[Function: ${value.name || '<anonymous>'}]`
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString()
    }
    if (typeof value === 'object') {
        if (memo.has(value)) {
            return '[Circular ~]'
        }
        if (remainingDepth <= 0) {
            return Array.isArray(value) ? '[Array]' : '[Object]'
        }
        memo.add(value)
        const result = Array.isArray(value)
            ? visitArray(value, remainingDepth - 1, maxBreadth, maxStringLength, memo)
            : visitObject(value as MutableRecord, remainingDepth - 1, maxBreadth, maxStringLength, memo)
        memo.delete(value)
        return result
    }
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
    obj: MutableRecord,
    remainingDepth: number,
    maxBreadth: number,
    maxStringLength: number,
    memo: WeakSet<object>
): MutableRecord {
    const result: MutableRecord = {}
    let count = 0
    for (const key of Object.keys(obj)) {
        if (count >= maxBreadth) {
            result['...'] = '[MaxProperties ~]'
            break
        }
        if (obj[key] === undefined) {
            continue
        }
        result[key] = visit(obj[key], remainingDepth, maxBreadth, maxStringLength, memo)
        count++
    }
    return result
}

function truncateString(str: string | undefined, maxLength: number): string | undefined {
    if (str == null || str.length <= maxLength) {
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

const textEncoder = new TextEncoder()

function jsonByteSize(value: unknown): number {
    return textEncoder.encode(JSON.stringify(value)).length
}

/** Last-resort: shrink the largest string values until the event fits the byte budget. */
function truncateLargestFields<T>(obj: T, maxBytes: number): T {
    const result = structuredClone(obj)
    for (let attempt = 0; attempt < 10; attempt++) {
        if (jsonByteSize(result) <= maxBytes) {
            return result
        }
        const excess = jsonByteSize(result) - maxBytes
        const stringPaths: Array<{ path: string[]; length: number }> = []
        collectStringPaths(result, [], stringPaths)
        stringPaths.sort((a, b) => b.length - a.length)
        if (stringPaths.length === 0) {
            break
        }
        let remaining = excess + 200
        let truncated = false
        for (const { path, length } of stringPaths) {
            if (remaining <= 0) {
                break
            }
            const reduction = Math.min(remaining, Math.floor(length * 0.5))
            if (reduction < 10) {
                continue
            }
            const currentValue = getNestedValue(result, path)
            if (typeof currentValue !== 'string') {
                continue
            }
            setNestedValue(result, path, currentValue.slice(0, length - reduction) + TRUNCATION_SUFFIX)
            remaining -= reduction
            truncated = true
        }
        if (!truncated) {
            break
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
        obj.forEach((item, i) => collectStringPaths(item, [...currentPath, String(i)], results))
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
 * Bounds a CLI event before capture: caps field-level string lengths and the
 * flags array, normalizes custom properties + error, then enforces the overall
 * byte budget (progressive depth reduction, then last-resort string shrinking).
 */
export function truncateEvent(event: CliEvent): CliEvent {
    const result: CliEvent = { ...event }

    result.intent = truncateString(result.intent, MAX_INTENT_LENGTH)
    result.command = truncateString(result.command, MAX_NAME_LENGTH)
    result.subcommand = truncateString(result.subcommand, MAX_NAME_LENGTH)
    if (result.flags) {
        result.flags = result.flags.slice(0, MAX_FLAGS).map((flag) => truncateString(flag, MAX_NAME_LENGTH) as string)
    }
    if (result.error != null && typeof result.error === 'object') {
        result.error = truncateExceptionList(result.error)
    }
    if (result.properties != null) {
        result.properties = normalize(result.properties) as JsonRecord
    }

    if (jsonByteSize(result) <= MAX_EVENT_BYTES) {
        return result
    }
    for (let depth = MAX_DEPTH - 1; depth >= 1; depth--) {
        const reduced: CliEvent = { ...result }
        if (reduced.properties != null) {
            reduced.properties = normalize(reduced.properties, depth) as JsonRecord
        }
        if (jsonByteSize(reduced) <= MAX_EVENT_BYTES) {
            return reduced
        }
    }
    return truncateLargestFields(result, MAX_EVENT_BYTES)
}
