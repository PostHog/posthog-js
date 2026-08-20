import Config from '../config'
import { isUndefined } from '@posthog/core'
import type { Logger } from '@posthog/types'
import { window } from './globals'

const POSTHOG_LOGGER_ACTIVE = '__PosthogLoggerActive__'

interface DebugWindow extends Window {
    POSTHOG_DEBUG?: boolean
    [POSTHOG_LOGGER_ACTIVE]?: boolean
}

// The logger and exception autocapture can run from separate bundles, so share this synchronous guard on window.
export const isPostHogLoggerActive = (): boolean => !!(window && (window as DebugWindow)[POSTHOG_LOGGER_ACTIVE])

const withPostHogLoggerActive = (callback: () => void): void => {
    const debugWindow = window as DebugWindow | undefined
    if (!debugWindow) {
        callback()
        return
    }

    const wasActive = debugWindow[POSTHOG_LOGGER_ACTIVE]
    debugWindow[POSTHOG_LOGGER_ACTIVE] = true
    try {
        callback()
    } finally {
        if (isUndefined(wasActive)) {
            delete debugWindow[POSTHOG_LOGGER_ACTIVE]
        } else {
            debugWindow[POSTHOG_LOGGER_ACTIVE] = wasActive
        }
    }
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
            if (
                window &&
                (Config.DEBUG || (window as DebugWindow).POSTHOG_DEBUG || debugEnabled) &&
                !isUndefined(window.console) &&
                window.console
            ) {
                const consoleLog =
                    '__rrweb_original__' in window.console[level]
                        ? (window.console[level] as any)['__rrweb_original__']
                        : window.console[level]

                withPostHogLoggerActive(() => consoleLog(prefix, ...args))
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
            // eslint-disable-next-line no-console
            withPostHogLoggerActive(() => console.error(prefix, ...args))
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
