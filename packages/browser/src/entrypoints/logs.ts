import { logs } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'

import { assignableWindow } from '../utils/globals'
import { PostHog } from '../posthog-core'
import { isObject } from '@posthog/core'

const setupOpenTelemetry = (posthog: PostHog) => {
    let attributes: Record<string, string> = {
        'service.name': 'posthog-browser-logs',
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
                    })
                ),
            ],
        })
    )
}

const LOG_BODY_SIZE_LIMIT = 100000
const LOG_ATTRIBUTES_LIMIT = 50

/**
 * Flattens a nested object into a single level dot-notation object.
 * By default limit to 200kB or 50 keys.
 */
const flattenObject = (
    obj: any,
    prefix = '',
    result = {} as Record<string, any>,
    keys_limit = LOG_ATTRIBUTES_LIMIT,
    size_limit = LOG_BODY_SIZE_LIMIT
) => {
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key]
            const newKey = prefix ? `${prefix}.${key}` : key

            if (isObject(value)) {
                flattenObject(value, newKey, result, keys_limit, size_limit)
            } else {
                keys_limit -= 1
                size_limit -= value.toString().length
                size_limit -= newKey.length
                if (keys_limit <= 0 || size_limit <= 0) {
                    result['attributes_truncated'] = true
                    return
                } else {
                    result[newKey] = value
                }
            }
        }
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
        const errorReplacer = (_: any, value: any) => {
            if (value instanceof Error) {
                return {
                    ...value,
                    name: value.name,
                    message: value.message,
                    stack: value.stack,
                }
            }
            return value
        }
        const logWrapper =
            (originalConsoleLog: any) =>
            (...args: any[]) => {
                if (args.length > 0) {
                    let body = args.map((a) => JSON.stringify(a, errorReplacer)).join(' ')
                    if (body.length > LOG_BODY_SIZE_LIMIT) {
                        body = body.slice(0, LOG_BODY_SIZE_LIMIT) + '...'
                        attributes.body_truncated = 'true'
                    }
                    logger.emit({
                        severityText: SEVERITY_MAP[level],
                        body: body,
                        attributes: {
                            'log.source': `console.${level}`,
                            distinct_id: posthog.get_distinct_id(),
                            'location.href': assignableWindow.location.href,
                            ...attributes,
                            ...(isObject(args[0]) ? flattenObject(args[0]) : {}),
                        },
                    })
                    originalConsoleLog.apply(assignableWindow.console, args)
                }
            }

        // If session replay is enabled it copies the original console log function to __rrweb_original__
        // wrap this one too
        let originalConsoleLog = assignableWindow.console[level]
        if ('__rrweb_original__' in assignableWindow.console[level]) {
            originalConsoleLog = assignableWindow.console[level]['__rrweb_original__'] as {
                (...data: any[]): void
                (...data: any[]): void
                (message?: any, ...optionalParams: any[]): void
            }
            assignableWindow.console[level]['__rrweb_original__'] = logWrapper(originalConsoleLog)
        }
        assignableWindow.console[level] = logWrapper(originalConsoleLog)
    }
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.logs = { initializeLogs }
