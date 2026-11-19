import type { ExceptionCapture } from '../shared/exception-autocapture'
import { createExceptionObserver } from '../shared/exception-autocapture'

/**
 * Monitor only by default: a rejection listener would change Node's default throw/exit behavior.
 * `captureUnhandledRejections` opts in to that listener anyway, because Electron's main process
 * only warns about rejections and never escalates them to the monitor.
 */
export function startProcessExceptionAutocapture(
    canCapture: () => boolean,
    capture: ExceptionCapture,
    captureUnhandledRejections = false
): () => void {
    const observe = createExceptionObserver(canCapture, capture)
    let escalated = false
    const monitor = (error: Error, origin: NodeJS.UncaughtExceptionOrigin): void => {
        const rejection = origin === 'unhandledRejection'
        escalated = rejection
        observe(
            error,
            rejection ? 'onunhandledrejection' : 'onuncaughtexception',
            rejection ? 'node.process_unhandled_rejection' : 'node.process_uncaught_exception'
        )
    }
    // Strict mode escalates to the monitor, then synchronously emits unhandledRejection for the same rejection.
    const rejection = (reason: unknown): void => {
        if (escalated) {
            escalated = false
            return
        }
        observe(reason, 'onunhandledrejection', 'node.process_unhandled_rejection')
    }
    process.on('uncaughtExceptionMonitor', monitor)
    if (captureUnhandledRejections) process.on('unhandledRejection', rejection)
    return () => {
        process.removeListener('uncaughtExceptionMonitor', monitor)
        process.removeListener('unhandledRejection', rejection)
    }
}
