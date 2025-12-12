import Config from '../config'
import { isUndefined } from '@posthog/core'
import { assignableWindow, window } from './globals'
import type { Logger } from '@posthog/core'

type CreateLoggerOptions = {
    debugEnabled?: boolean
}

type PosthogJsLogger = Omit<Logger, 'createLogger'> & {
    _log: (level: 'log' | 'warn' | 'error', ...args: any[]) => void
    uninitializedWarning: (methodName: string) => void
    createLogger: (prefix: string, options?: CreateLoggerOptions) => PosthogJsLogger
}

const _createLogger = (prefix: string, { debugEnabled }: CreateLoggerOptions = {}): PosthogJsLogger => {
    const logger: PosthogJsLogger = {
        _log: (level: 'log' | 'warn' | 'error', ...args: any[]) => {
            if (
                window &&
                (Config.DEBUG || assignableWindow.POSTHOG_DEBUG || debugEnabled) &&
                !isUndefined(window.console) &&
                window.console
            ) {
                const consoleLog =
                    '__rrweb_original__' in window.console[level]
                        ? (window.console[level] as any)['__rrweb_original__']
                        : window.console[level]

                // eslint-disable-next-line no-console
                consoleLog(prefix, ...args)
            }
        },

        info: (...args: any[]) => {
            logger._log('log', ...args)
        },

        warn: (...args: any[]) => {
            logger._log('warn', ...args)
        },

        error: (...args: any[]) => {
            logger._log('error', ...args)
        },

        critical: (...args: any[]) => {
            // Critical errors are always logged to the console
            // eslint-disable-next-line no-console
            console.error(prefix, ...args)
        },

        uninitializedWarning: (methodName: string) => {
            logger.error(`You must initialize PostHog before calling ${methodName}`)
        },

        createLogger: (additionalPrefix: string, options?: CreateLoggerOptions) =>
            _createLogger(`${prefix} ${additionalPrefix}`, options),
    }
    return logger
}

export const logger = _createLogger('[PostHog.js]')

export const createLogger = logger.createLogger
