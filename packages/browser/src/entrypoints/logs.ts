import { assignableWindow } from '@posthog/browser-common/utils/globals'
import { PostHog } from '../posthog-core'
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

type ConsoleLevel = 'debug' | 'log' | 'warn' | 'error' | 'info'

// Console method → OTLP severity level. `log` and `info` both map to `info`;
// the originating method is preserved separately via the `log.source` attribute.
const LEVEL_MAP: Record<ConsoleLevel, LogSeverityLevel> = {
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

const initializeLogs = (posthog: PostHog) => {
    // `host` is carried here because the core SDK context has no equivalent. Session
    // attributes (window.id, sessionStartTimestamp, lastActivityTimestamp) are added
    // downstream by the core pipeline from the SDK context, alongside sessionId.
    const attributes: Record<string, string> = { host: assignableWindow.location.host }

    // Re-entrancy guard: the capture path itself logs — `_captureConsoleLog` calls into
    // session management, which emits internal debug lines through PostHog's own logger,
    // which in turn writes to the (now wrapped) console. Without this flag that would
    // re-enter capture and recurse until the stack overflows.
    let isCapturingLog = false

    for (const level of Object.keys(LEVEL_MAP) as ConsoleLevel[]) {
        const logWrapper =
            (originalConsoleLog: any) =>
            (...args: any[]) => {
                // Tracks whether *this* invocation acquired the re-entrancy guard, so that a
                // nested console call which skips capture doesn't release the guard early and
                // reopen the capture path while the outer invocation is still running.
                let acquiredGuard = false
                try {
                    if (args.length > 0 && !isCapturingLog && posthog.is_capturing()) {
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
                        // The core pipeline adds posthogDistinctId and url.full from the SDK context.
                        posthog.logs?._captureConsoleLog({
                            level: LEVEL_MAP[level],
                            body,
                            attributes: {
                                'log.source': `console.${level}`,
                                ...logAttributes,
                                ...flattenedAttributes,
                            },
                        })
                    }
                } catch {
                    // Capture must never break the page's own console output, so the
                    // real console call below always runs even if capture throws.
                } finally {
                    if (acquiredGuard) {
                        isCapturingLog = false
                    }
                    originalConsoleLog.apply(assignableWindow.console, args)
                }
            }

        const originalConsoleLog = assignableWindow.console[level]
        const wrapped = logWrapper(originalConsoleLog)
        // Expose the original console method the same way rrweb's console plugin does, so
        // PostHog's internal logger (utils/logger.ts) writes to the real console instead of
        // re-entering this wrapper when it emits debug lines from inside the capture path.
        // Flatten an existing marker if another console plugin already wrapped this method.
        ;(wrapped as any).__rrweb_original__ = originalConsoleMethod(originalConsoleLog)
        assignableWindow.console[level] = wrapped
    }
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.logs = { initializeLogs }
