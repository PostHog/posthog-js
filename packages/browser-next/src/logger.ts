import type { Client } from '@posthog/browser-common'
import { originalConsoleMethod } from '@posthog/browser-common/utils/console-original'

type Logger = Client['logger']
type ConsoleLevel = 'debug' | 'log' | 'warn' | 'error'

export const createLogger = (prefix: string, enabled: boolean): Logger => {
    const write = (level: ConsoleLevel, args: unknown[]): void => {
        if (!enabled) {
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
        createLogger: (childPrefix: string) => createLogger(`${prefix} ${childPrefix}`, enabled),
    }
}
