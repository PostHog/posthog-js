import { Logger } from '@posthog/core'

const _createLogger = (prefix: string, logMsgIfDebug: (fn: () => void) => void): Logger => {
  const logger: Logger = {
    _log: (level: 'log' | 'warn' | 'error', ...args: any[]) => {
      logMsgIfDebug(() => {
        const consoleLog = console[level]
        consoleLog(prefix, ...args)
      })
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

    createLogger: (additionalPrefix: string) => _createLogger(`${prefix} ${additionalPrefix}`, logMsgIfDebug),
  }
  return logger
}

export const createLogger = (logMsgIfDebug: (fn: () => void) => void) => _createLogger('[PostHog.js]', logMsgIfDebug)
