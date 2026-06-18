/**
 * Opt-in logger for SDK-internal warnings.
 *
 * A CLI may use stdout to emit machine-readable output (JSON, pipes), so the SDK
 * never writes there on its own. When no `logger` is supplied, log calls are
 * silently dropped. Consumers that want visibility can plug in any function
 * (e.g. `console.error`, a debug logger, a file sink). Logging failures are
 * swallowed so they can never break the capture pipeline or the host command.
 */
export type LoggerFn = (message: string) => void

let activeLogger: LoggerFn | undefined

export function setLogger(logger: LoggerFn | undefined): void {
    activeLogger = logger
}

export function log(message: string): void {
    if (activeLogger) {
        try {
            activeLogger(message)
        } catch {
            // never let logging blow up the tracking pipeline
        }
    }
}
