import { logs } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'

import { assignableWindow } from '../utils/globals'
import { PostHog } from '../posthog-core'

const setupOpenTelemetry = (posthog: PostHog) => {
    let attributes: Record<string, string> = {
        'service.name': 'posthog-browser-logs',
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
            processors: [new BatchLogRecordProcessor(new OTLPLogExporter({
              url: `${posthog.config.api_host}/i/v1/logs?token=${posthog.config.token}`,
            }))],
        })
    )
}

const initializeLogs = (posthog: PostHog) => {
    setupOpenTelemetry(posthog)

    const logger = logs.getLogger('console')

    for (const level of ['log', 'warn', 'error'] as ('log' | 'warn' | 'error')[]) {
        const logWrapper =
            (originalConsoleLog: any) =>
            (...args: any[]) => {
                logger.emit({
                    severityText: {
                        log: 'INFO',
                        warn: 'WARNING',
                        error: 'ERROR',
                    }[level],
                    body: args.map((a) => JSON.stringify(a)).join(' '),
                    attributes: {
                        'log.source': `console.${level}`,
                        distinct_id: posthog.get_distinct_id(),
                    },
                })
                originalConsoleLog.apply(assignableWindow.console, args)
            }

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
assignableWindow.__PosthogExtensions__.initializeLogs = initializeLogs
