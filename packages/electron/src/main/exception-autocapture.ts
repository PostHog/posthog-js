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
    let escalated: unknown
    const monitor = (error: Error, origin: NodeJS.UncaughtExceptionOrigin): void => {
        const rejection = origin === 'unhandledRejection'
        if (rejection) escalated = error
        observe(
            error,
            rejection ? 'onunhandledrejection' : 'onuncaughtexception',
            rejection ? 'node.process_unhandled_rejection' : 'node.process_uncaught_exception'
        )
    }
    // Strict mode escalates to the monitor, then emits unhandledRejection for the same rejection. Node wraps
    // a non-Error reason in an ERR_UNHANDLED_REJECTION error, so the reason itself only matches Error reasons.
    const rejection = (reason: unknown): void => {
        const wrapped = (escalated as { code?: unknown } | undefined)?.code === 'ERR_UNHANDLED_REJECTION'
        if (escalated !== undefined && (reason === escalated || (wrapped && !(reason instanceof Error)))) {
            escalated = undefined
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
