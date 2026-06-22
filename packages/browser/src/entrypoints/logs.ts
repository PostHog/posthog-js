import { logs } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'

import { assignableWindow } from '../utils/globals'
import { PostHog } from '../posthog-core'
import { isArray, isBoolean, isFunction, isNull, isNumber, isObject, stripUrlHash } from '@posthog/core'

const setupOpenTelemetry = (posthog: PostHog) => {
    const serviceName = posthog.config.logs?.serviceName || 'posthog-browser-logs'
    let attributes: Record<string, string> = {
        'service.name': serviceName,
        host: assignableWindow.location.host,
    }

    if (posthog.sessionManager) {
        const { sessionId, windowId } = posthog.sessionManager.checkAndGetSessionAndWindowId(true)
        attributes = {
            ...attributes,
            'session.id': sessionId,
            'window.id': windowId,
        }
    }

    logs.setGlobalLoggerProvider(
        new LoggerProvider({
            resource: resourceFromAttributes(attributes),
            processors: [
                new BatchLogRecordProcessor(
                    new OTLPLogExporter({
                        url: `${posthog.config.api_host}/i/v1/logs?token=${posthog.config.token}`,
                        // 1. Force the content type to text/plain to avoid OPTIONS preflight
                        headers: {
                            'Content-Type': 'text/plain',
                        },
                    })
                ),
            ],
        })
    )
}

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

const SEVERITY_MAP = {
    log: 'INFO',
    warn: 'WARNING',
    error: 'ERROR',
    debug: 'DEBUG',
    info: 'INFO',
}

const initializeLogs = (posthog: PostHog) => {
    setupOpenTelemetry(posthog)

    const logger = logs.getLogger('console')
    let attributes: Record<string, string> = {}
    if (posthog.sessionManager) {
        const { sessionStartTimestamp, lastActivityTimestamp } =
            posthog.sessionManager.checkAndGetSessionAndWindowId(true)
        attributes = {
            sessionStartTimestamp: sessionStartTimestamp.toString(),
            lastActivityTimestamp: lastActivityTimestamp.toString(),
        }
    }

    for (const level of ['debug', 'log', 'warn', 'error', 'info'] as ('debug' | 'log' | 'warn' | 'error' | 'info')[]) {
        const logWrapper =
            (originalConsoleLog: any) =>
            (...args: any[]) => {
                if (args.length === 0) {
                    return
                }

                if (!posthog.is_capturing()) {
                    originalConsoleLog.apply(assignableWindow.console, args)
                    return
                }

                const { body, truncated } = stringifyArgsSafely(args, LOG_BODY_SIZE_LIMIT)
                const logAttributes = {
                    ...attributes,
                    ...(truncated ? { body_truncated: 'true' } : {}),
                }
                logger.emit({
                    severityText: SEVERITY_MAP[level],
                    body: body,
                    attributes: {
                        'log.source': `console.${level}`,
                        distinct_id: posthog.get_distinct_id(),
                        'location.href': posthog.config.disable_capture_url_hashes
                            ? stripUrlHash(assignableWindow.location.href)
                            : assignableWindow.location.href,
                        ...logAttributes,
                        ...(isObject(args[0]) ? flattenObject(args[0]) : {}),
                    },
                })
                originalConsoleLog.apply(assignableWindow.console, args)
            }

        const originalConsoleLog = assignableWindow.console[level]
        assignableWindow.console[level] = logWrapper(originalConsoleLog)
    }
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.logs = { initializeLogs }
