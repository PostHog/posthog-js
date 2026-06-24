import { assignableWindow } from '../utils/globals'
import { PostHog } from '../posthog-core'
import { isArray, isBoolean, isFunction, isNull, isNumber, isObject } from '@posthog/core'
import type { LogSeverityLevel } from '@posthog/types'

const LOG_BODY_SIZE_LIMIT = 10000
const LOG_ATTRIBUTES_LIMIT = 50

type StringifyBudget = {
    remaining: number
    truncated: boolean
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

const stringifyValueWithLimit = (
    value: any,
    parts: string[],
    budget: StringifyBudget,
    seen: WeakSet<object>,
    inArray = false
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
        return stringifyValueWithLimit(errorObject, parts, budget, seen, inArray)
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

const stringifyArgsSafely = (args: any[], sizeLimit: number): { body: string; truncated: boolean } => {
    const parts: string[] = []
    const budget = { remaining: sizeLimit, truncated: false }
    for (let i = 0; i < args.length; i++) {
        if (i > 0 && !appendWithLimit(parts, ' ', budget)) {
            break
        }
        if (!stringifyValueWithLimit(args[i], parts, budget, new WeakSet<object>())) {
            break
        }
    }

    return {
        body: parts.join('') + (budget.truncated ? '...' : ''),
        truncated: budget.truncated,
    }
}

/**
 * Flattens a nested object into a single level dot-notation object.
 * By default limit to 200kB or 50 keys.
 */
const flattenObject = (
    obj: any,
    prefix = '',
    result = {} as Record<string, any>,
    keys_limit = LOG_ATTRIBUTES_LIMIT,
    size_limit = LOG_BODY_SIZE_LIMIT,
    seen = new WeakSet()
) => {
    if (seen.has(obj)) {
        result[prefix || 'circular'] = '[Circular]'
        return result
    }
    seen.add(obj)

    try {
        for (const key in obj) {
            try {
                if (!Object.prototype.hasOwnProperty.call(obj, key)) {
                    continue
                }
                const value = obj[key]
                const newKey = prefix ? `${prefix}.${key}` : key

                if (isObject(value)) {
                    flattenObject(value, newKey, result, keys_limit, size_limit, seen)
                } else {
                    keys_limit -= 1
                    size_limit -= String(value).length
                    size_limit -= newKey.length
                    if (keys_limit <= 0 || size_limit <= 0) {
                        result['attributes_truncated'] = true
                        return
                    } else {
                        result[newKey] = value
                    }
                }
            } catch {
                continue
            }
        }
    } catch {
        // we'll omit this object's properties considering we can't enumerate them
    }
    return result
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

const initializeLogs = (posthog: PostHog) => {
    const getLogAttributes = (): Record<string, string> => {
        // `host` is carried per record because the core SDK context has no equivalent.
        const attributes: Record<string, string> = { host: assignableWindow.location.host }
        if (posthog.sessionManager) {
            const { windowId, sessionStartTimestamp, lastActivityTimestamp } =
                posthog.sessionManager.checkAndGetSessionAndWindowId(true)
            attributes['window.id'] = windowId
            if (sessionStartTimestamp != null) {
                attributes.sessionStartTimestamp = sessionStartTimestamp.toString()
            }
            if (lastActivityTimestamp != null) {
                attributes.lastActivityTimestamp = lastActivityTimestamp.toString()
            }
        }

        return attributes
    }

    for (const level of Object.keys(LEVEL_MAP) as ConsoleLevel[]) {
        const logWrapper =
            (originalConsoleLog: any) =>
            (...args: any[]) => {
                try {
                    if (args.length > 0 && posthog.is_capturing()) {
                        const { body, truncated } = stringifyArgsSafely(args, LOG_BODY_SIZE_LIMIT)
                        const logAttributes = {
                            ...getLogAttributes(),
                            ...(truncated ? { body_truncated: 'true' } : {}),
                        }
                        // The core pipeline adds posthogDistinctId and url.full from the SDK context.
                        posthog.logs?._captureConsoleLog({
                            level: LEVEL_MAP[level],
                            body,
                            attributes: {
                                'log.source': `console.${level}`,
                                ...logAttributes,
                                ...(isObject(args[0]) ? flattenObject(args[0]) : {}),
                            },
                        })
                    }
                } catch {
                    // Capture must never break the page's own console output, so the
                    // real console call below always runs even if capture throws.
                } finally {
                    originalConsoleLog.apply(assignableWindow.console, args)
                }
            }

        const originalConsoleLog = assignableWindow.console[level]
        assignableWindow.console[level] = logWrapper(originalConsoleLog)
    }
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.logs = { initializeLogs }
