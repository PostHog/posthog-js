import Config from '../config'
import { isUndefined } from '@posthog/core'
import type { Logger } from '@posthog/types'

interface DebugWindow extends Window {
    POSTHOG_DEBUG?: boolean
}

export type CreateLoggerOptions = {
    debugEnabled?: boolean
}

export type PosthogJsLogger = Omit<Logger, 'createLogger' | 'debug' | 'info' | 'warn' | 'error' | 'trace' | 'fatal'> & {
    _log: (level: 'debug' | 'log' | 'warn' | 'error', ...args: any[]) => void
    debug: (...args: any[]) => void
    info: (...args: any[]) => void
    warn: (...args: any[]) => void
    error: (...args: any[]) => void
    critical: (...args: any[]) => void
    uninitializedWarning: (methodName: string) => void
    createLogger: (prefix: string, options?: CreateLoggerOptions) => PosthogJsLogger
}

const _createLogger = (prefix: string, { debugEnabled }: CreateLoggerOptions = {}): PosthogJsLogger => {
    const logger: PosthogJsLogger = {
        _log: (level: 'debug' | 'log' | 'warn' | 'error', ...args: any[]) => {
            let browserWindow: (Window & typeof globalThis) | undefined
            try {
                browserWindow = typeof window === 'undefined' ? undefined : window
            } catch {
                return
            }
            if (
                browserWindow &&
                (Config.DEBUG || (browserWindow as DebugWindow).POSTHOG_DEBUG || debugEnabled) &&
                !isUndefined(browserWindow.console) &&
                browserWindow.console
            ) {
                const consoleLog =
                    '__rrweb_original__' in browserWindow.console[level]
                        ? (browserWindow.console[level] as any)['__rrweb_original__']
                        : browserWindow.console[level]

                consoleLog(prefix, ...args)
            }
        },

        debug: (...args: any[]) => {
            logger._log('debug', ...args)
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
            // oxlint-disable-next-line no-console
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
