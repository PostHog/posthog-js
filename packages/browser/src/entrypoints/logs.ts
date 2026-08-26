import { assignableWindow } from '../utils/globals'
import { patch } from '../extensions/replay/rrweb-plugins/patch'
import type { BufferedConsoleEntry, BufferedConsoleLevel } from '../logs-types'
import { LogsExtension } from '../extension-tokens'
import type { PostHog } from '../posthog-core'
import type { CaptureLogOptions } from '../types'
import type { Client } from '@posthog/browser-common'
import { isArray, isBoolean, isFunction, isNull, isNumber, isObject } from '@posthog/core'
import type { LogSeverityLevel } from '@posthog/types'

const LOG_BODY_SIZE_LIMIT = 10000
const LOG_ATTRIBUTES_LIMIT = 50

type StringifyBudget = {
    remaining: number
    truncated: boolean
}

type AttributeCollector = {
    result: Record<string, any>
    keysRemaining: number
    sizeRemaining: number
    truncated: boolean
    seen: WeakSet<object>
}

const appendWithLimit = (parts: string[], text: string, budget: StringifyBudget): boolean => {
    if (budget.remaining <= 0) {
        budget.truncated = true
        return false
    }

    if (text.length <= budget.remaining) {
        parts.push(text)
        budget.remaining -= text.length
        return true
    }

    parts.push(text.slice(0, budget.remaining))
    budget.remaining = 0
    budget.truncated = true
    return false
}

const stringifyStringWithLimit = (value: string, parts: string[], budget: StringifyBudget): boolean => {
    const serialized = JSON.stringify(value)
    if (serialized.length <= budget.remaining) {
        return appendWithLimit(parts, serialized, budget)
    }

    budget.truncated = true
    if (budget.remaining < 2) {
        return false
    }

    let low = 0
    let high = Math.min(value.length, budget.remaining - 2)
    while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (JSON.stringify(value.slice(0, mid)).length <= budget.remaining) {
            low = mid
        } else {
            high = mid - 1
        }
    }

    return appendWithLimit(parts, JSON.stringify(value.slice(0, low)), budget)
}

const isJSONSerializablePrimitive = (value: any): boolean =>
    typeof value !== 'undefined' &&
    typeof value !== 'function' &&
    typeof value !== 'symbol' &&
    typeof value !== 'bigint'

const isNumberOrBoolean = (value: any): boolean => {
    try {
        return isNumber(value) || isBoolean(value)
    } catch {
        return false
    }
}

const collectAttributeValue = (key: string, value: any, collector: AttributeCollector): void => {
    if (collector.truncated) {
        return
    }

    collector.keysRemaining -= 1
    collector.sizeRemaining -= String(value).length + key.length
    if (collector.keysRemaining <= 0 || collector.sizeRemaining <= 0) {
        collector.truncated = true
        collector.result['attributes_truncated'] = true
        return
    }

    collector.result[key] = value
}

const collectFlattenedAttributes = (value: any, key: string, collector: AttributeCollector): void => {
    if (collector.truncated) {
        return
    }

    if (isObject(value)) {
        if (collector.seen.has(value)) {
            collectAttributeValue(key || 'circular', '[Circular]', collector)
            return
        }
        collector.seen.add(value)

        try {
            for (const childKey in value) {
                try {
                    if (!Object.prototype.hasOwnProperty.call(value, childKey)) {
                        continue
                    }
                    const childValue = value[childKey]
                    collectFlattenedAttributes(childValue, key ? `${key}.${childKey}` : childKey, collector)
                    if (collector.truncated) {
                        return
                    }
                } catch {
                    continue
                }
            }
        } catch {
            // we'll omit this object's properties considering we can't enumerate them
        }
        return
    }

    collectAttributeValue(key, value, collector)
}

const stringifyValueWithLimit = (
    value: any,
    parts: string[],
    budget: StringifyBudget,
    seen: WeakSet<object>,
    inArray = false,
    attributeCollector?: AttributeCollector
): boolean => {
    if (!isJSONSerializablePrimitive(value)) {
        return inArray ? appendWithLimit(parts, 'null', budget) : true
    }

    if (isNull(value) || isNumberOrBoolean(value)) {
        return appendWithLimit(parts, JSON.stringify(value), budget)
    }

    if (typeof value === 'string') {
        return stringifyStringWithLimit(value, parts, budget)
    }

    if (!isObject(value) && !isArray(value)) {
        return appendWithLimit(parts, JSON.stringify(value), budget)
    }

    if (seen.has(value)) {
        return stringifyStringWithLimit('[Circular]', parts, budget)
    }
    seen.add(value)

    try {
        const toJSON = (value as any).toJSON
        if (isFunction(toJSON)) {
            return stringifyValueWithLimit(toJSON.call(value), parts, budget, seen, inArray)
        }
    } catch {
        // If toJSON can't be read or throws, fall through to safe property enumeration.
    }

    try {
        const objectTag = Object.prototype.toString.call(value)
        if (objectTag === '[object String]') {
            return stringifyStringWithLimit(String(value.valueOf()), parts, budget)
        }

        if (objectTag === '[object Number]' || objectTag === '[object Boolean]') {
            return appendWithLimit(parts, JSON.stringify(value.valueOf()), budget)
        }
    } catch {
        // If Object.prototype.toString or valueOf throws, fall through to safe property enumeration.
    }

    if (value instanceof Error) {
        const errorObject: Record<string, any> = {}
        try {
            for (const key in value) {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    errorObject[key] = value[key as keyof Error]
                }
            }
        } catch {}
        try {
            errorObject.name = value.name
        } catch {}
        try {
            errorObject.message = value.message
        } catch {}
        try {
            errorObject.stack = value.stack
        } catch {}
        return stringifyValueWithLimit(errorObject, parts, budget, seen, inArray, attributeCollector)
    }

    if (isArray(value)) {
        if (!appendWithLimit(parts, '[', budget)) {
            return false
        }
        for (let i = 0; i < value.length; i++) {
            if (i > 0 && !appendWithLimit(parts, ',', budget)) {
                return false
            }
            let item
            try {
                item = value[i]
            } catch {
                item = undefined
            }
            if (!stringifyValueWithLimit(item, parts, budget, seen, true)) {
                return false
            }
        }
        return appendWithLimit(parts, ']', budget)
    }

    if (!appendWithLimit(parts, '{', budget)) {
        return false
    }
    let isFirst = true
    try {
        for (const key in value) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                continue
            }
            if (budget.remaining <= 0) {
                budget.truncated = true
                return false
            }

            let propertyValue
            try {
                propertyValue = value[key]
            } catch {
                continue
            }
            if (attributeCollector) {
                try {
                    collectFlattenedAttributes(propertyValue, key, attributeCollector)
                } catch {
                    // we'll omit this object's attributes considering we can't read them safely
                }
            }

            if (!isJSONSerializablePrimitive(propertyValue)) {
                continue
            }

            const propertyPrefix = `${isFirst ? '' : ','}${JSON.stringify(key)}:`
            if (propertyPrefix.length >= budget.remaining) {
                budget.truncated = true
                return false
            }

            const partsBeforeProperty = parts.length
            const remainingBeforeProperty = budget.remaining
            const truncatedBeforeProperty = budget.truncated
            if (!appendWithLimit(parts, propertyPrefix, budget)) {
                return false
            }

            const partsBeforeValue = parts.length
            const serialized = stringifyValueWithLimit(propertyValue, parts, budget, seen, false)
            const truncatedAfterValue = budget.truncated
            if (parts.length === partsBeforeValue) {
                parts.length = partsBeforeProperty
                budget.remaining = remainingBeforeProperty
                budget.truncated = serialized ? truncatedBeforeProperty : truncatedAfterValue
                if (!serialized) {
                    return false
                }
                continue
            }

            isFirst = false
            if (!serialized) {
                return false
            }
        }
    } catch {
        // we'll omit this object's properties considering we can't enumerate them
    }
    return appendWithLimit(parts, '}', budget)
}

const stringifyArgsSafely = (
    args: any[],
    sizeLimit: number
): { body: string; truncated: boolean; attributes: Record<string, any> } => {
    const parts: string[] = []
    const budget = { remaining: sizeLimit, truncated: false }
    const attributeCollector: AttributeCollector | undefined = isObject(args[0])
        ? {
              result: {},
              keysRemaining: LOG_ATTRIBUTES_LIMIT,
              sizeRemaining: LOG_BODY_SIZE_LIMIT,
              truncated: false,
              seen: new WeakSet<object>([args[0]]),
          }
        : undefined

    for (let i = 0; i < args.length; i++) {
        if (i > 0 && !appendWithLimit(parts, ' ', budget)) {
            break
        }
        if (
            !stringifyValueWithLimit(
                args[i],
                parts,
                budget,
                new WeakSet<object>(),
                false,
                i === 0 ? attributeCollector : undefined
            )
        ) {
            break
        }
    }

    return {
        body: parts.join('') + (budget.truncated ? '...' : ''),
        truncated: budget.truncated,
        attributes: attributeCollector?.result || {},
    }
}

// Console method → OTLP severity level. `log` and `info` both map to `info`;
// the originating method is preserved separately via the `log.source` attribute.
const LEVEL_MAP: Record<BufferedConsoleLevel, LogSeverityLevel> = {
    debug: 'debug',
    log: 'info',
    warn: 'warn',
    error: 'error',
    info: 'info',
}

const originalConsoleMethod = (method: any): any => {
    while (method?.__rrweb_original__) {
        method = method.__rrweb_original__
    }
    return method
}

const isClient = (host: PostHog | Client): host is Client => 'canCapture' in host

const getCapturingLogs = (host: PostHog | Client) => {
    if (isClient(host)) {
        return host.canCapture ? host.getExtension(LogsExtension) : undefined
    }
    return host.is_capturing() ? host.logs : undefined
}

type HistoricalCaptureConsoleLogName = 'le' | 'de' | 'he' | 'ui' | 'ci' | 'vi'
type HistoricalLogs = Partial<Record<HistoricalCaptureConsoleLogName, (options: CaptureLogOptions) => void>>

// Compatibility for a bug where `_captureConsoleLog` was inadvertently used across
// independently built bundles and received different mangled names. Pre-stable-ABI
// cores used `le` through 1.410.4, `de` through 1.410.10, `he` through 1.418.3, `ui`
// through 1.418.10, `ci` through 1.418.14, and `vi` through 1.419.2.
const historicalCaptureConsoleLogName = (version: string): HistoricalCaptureConsoleLogName | undefined => {
    const match = /^1\.(\d+)\.(\d+)$/.exec(version)
    if (!match) {
        return undefined
    }

    const minor = Number(match[1])
    const patch = Number(match[2])
    if (minor < 392 || minor > 419) {
        return undefined
    }
    if (minor === 410) {
        return patch <= 4 ? 'le' : patch <= 10 ? 'de' : undefined
    }
    if (minor === 418) {
        return patch <= 3 ? 'he' : patch <= 10 ? 'ui' : patch <= 14 ? 'ci' : patch <= 17 ? 'vi' : undefined
    }
    if (minor === 419) {
        return patch <= 2 ? 'vi' : undefined
    }
    return minor < 410 ? 'le' : 'he'
}

const captureConsoleLogForHost = (
    host: PostHog | Client,
    logs: NonNullable<PostHog['logs']>,
    options: CaptureLogOptions
): void => {
    if (isClient(host)) {
        logs.captureConsoleLog(options)
        return
    }

    // `_captureConsoleLog` had six generated names across core-backed releases.
    // Select by the stable SDK version instead of probing generated names,
    // because the same name can identify a different method in another release.
    // Keep this historical ABI isolated here. A `captureLog` fallback would change the
    // service name, scope, queue, and rate limits.
    const name = historicalCaptureConsoleLogName(host.version)
    const historicalCaptureConsoleLog = name ? (logs as unknown as HistoricalLogs)[name] : undefined
    if (isFunction(historicalCaptureConsoleLog)) {
        historicalCaptureConsoleLog.call(logs, options)
    }
}

const initializeLogs = (host: PostHog | Client): (() => void) => {
    let currentHost: PostHog | Client | undefined = host
    const restoreConsoleMethods: Array<() => void> = []

    // `host` is carried here because the core SDK context has no equivalent. Session
    // attributes (window.id, sessionStartTimestamp, lastActivityTimestamp) are added
    // downstream by the core pipeline from the SDK context, alongside sessionId.
    const attributes: Record<string, string> = { host: assignableWindow.location.host }

    // Re-entrancy guard: the capture path itself logs — `captureConsoleLog` calls into
    // session management, which emits internal debug lines through PostHog's own logger,
    // which in turn writes to the (now wrapped) console. Without this flag that would
    // re-enter capture and recurse until the stack overflows.
    let isCapturingLog = false

    for (const level of Object.keys(LEVEL_MAP) as BufferedConsoleLevel[]) {
        const logWrapper =
            (next: any) =>
            (...args: any[]) => {
                // Tracks whether *this* invocation acquired the re-entrancy guard, so that a
                // nested console call which skips capture doesn't release the guard early and
                // reopen the capture path while the outer invocation is still running.
                let acquiredGuard = false
                try {
                    const activeHost = currentHost
                    if (args.length > 0 && !isCapturingLog && activeHost) {
                        const logs = getCapturingLogs(activeHost)
                        if (logs) {
                            isCapturingLog = true
                            acquiredGuard = true
                            const {
                                body,
                                truncated,
                                attributes: flattenedAttributes,
                            } = stringifyArgsSafely(args, LOG_BODY_SIZE_LIMIT)
                            const logAttributes = {
                                ...attributes,
                                ...(truncated ? { body_truncated: 'true' } : {}),
                            }
                            const options = {
                                level: LEVEL_MAP[level],
                                body,
                                attributes: {
                                    'log.source': `console.${level}`,
                                    ...logAttributes,
                                    ...flattenedAttributes,
                                },
                            }
                            // The core pipeline adds posthogDistinctId and url.full from the SDK context.
                            captureConsoleLogForHost(activeHost, logs, options)
                        }
                    }
                } catch {
                    // Capture must never break the page's own console output, so the
                    // real console call below always runs even if capture throws.
                } finally {
                    if (acquiredGuard) {
                        isCapturingLog = false
                    }
                    next.apply(assignableWindow.console, args)
                }
            }

        // Install as a `patch` layer rather than a bare assignment: session replay's
        // console plugin wraps these same methods and can arrive after this one, and a
        // top-of-stack-only restore leaks whichever wrapper ends up underneath — and
        // resurrects a lower one that has since been removed.
        const consoleBeforePatch = assignableWindow.console[level]
        restoreConsoleMethods.push(
            patch(assignableWindow.console, level, (next: any) => {
                const wrapped = logWrapper(next)
                // Lets PostHog's internal logger reach the real console instead of
                // re-entering this wrapper, and flattens a marker another plugin left.
                ;(wrapped as any).__rrweb_original__ = originalConsoleMethod(consoleBeforePatch)
                return wrapped
            })
        )
    }

    return () => {
        currentHost = undefined
        restoreConsoleMethods.forEach((restore) => restore())
    }
}

/** Replays console calls the main bundle recorded before this script loaded. */
const replayConsoleBuffer = (host: PostHog | Client, entries: BufferedConsoleEntry[]) => {
    const logs = getCapturingLogs(host)
    if (!logs) {
        return
    }
    for (const entry of entries) {
        try {
            const {
                body,
                truncated,
                attributes: flattenedAttributes,
            } = stringifyArgsSafely(entry.args, LOG_BODY_SIZE_LIMIT)
            logs.captureBufferedConsoleLog?.(
                {
                    level: LEVEL_MAP[entry.level],
                    body,
                    attributes: {
                        'log.source': `console.${entry.level}`,
                        host: assignableWindow.location.host,
                        ...(truncated ? { body_truncated: 'true' } : {}),
                        ...flattenedAttributes,
                    },
                },
                entry.context,
                entry.occurredAtMs
            )
        } catch {
            // One entry that cannot be captured must not drop the rest of the buffer.
        }
    }
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.logs = { initializeLogs, replayConsoleBuffer }
