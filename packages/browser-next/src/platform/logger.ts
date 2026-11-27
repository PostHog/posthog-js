import type { Client } from '@posthog/browser-common'
import { originalConsoleMethod } from '@posthog/browser-common/utils/console-original'

type Logger = Client['logger']
type ConsoleLevel = 'debug' | 'log' | 'warn' | 'error'

/** Shared output switch, so a runtime change reaches child loggers that extensions already created. */
export interface LogState {
    enabled: boolean
}

export const createLogger = (prefix: string, state: LogState): Logger => {
    const write = (level: ConsoleLevel, args: unknown[]): void => {
        if (!state.enabled) {
            return
        }

        try {
            const console = globalThis.console
            originalConsoleMethod(console?.[level])?.call(console, prefix, ...args)
        } catch {
            // Logging must not affect the host application.
        }
    }

    return {
        debug: (...args: unknown[]) => write('debug', args),
        info: (...args: unknown[]) => write('log', args),
        warn: (...args: unknown[]) => write('warn', args),
        error: (...args: unknown[]) => write('error', args),
        critical: (...args: unknown[]) => write('error', args),
        createLogger: (childPrefix: string) => createLogger(`${prefix} ${childPrefix}`, state),
    }
}
