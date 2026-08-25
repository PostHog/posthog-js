import Config from '../config'
import { isFunction, isUndefined } from '@posthog/core'
import type { Logger } from '@posthog/types'
import { getOriginalConsoleMethod } from './console-utils'
import { window } from './globals'

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
    const writeToConsole = (level: 'debug' | 'log' | 'warn' | 'error', ...args: any[]): void => {
        const targetConsole = window?.console ?? console
        const consoleLog = getOriginalConsoleMethod(targetConsole[level] as any)
        if (isFunction(consoleLog)) {
            consoleLog(prefix, ...args)
        }
    }

    const logger: PosthogJsLogger = {
        _log: (level: 'debug' | 'log' | 'warn' | 'error', ...args: any[]) => {
            if (
                window &&
                (Config.DEBUG || (window as DebugWindow).POSTHOG_DEBUG || debugEnabled) &&
                !isUndefined(window.console) &&
                window.console
            ) {
                writeToConsole(level, ...args)
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
            writeToConsole('error', ...args)
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
