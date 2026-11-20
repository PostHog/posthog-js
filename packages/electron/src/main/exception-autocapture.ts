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
    const observe = createExceptionObserver(
        canCapture,
        capture,
        (error, mechanism) => mechanism === 'onunhandledrejection' && isAbortError(error)
    )
    const monitor = (error: Error, origin: NodeJS.UncaughtExceptionOrigin): void => {
        const rejection = origin === 'unhandledRejection'
        // The rejection listener reports every rejection, including any Node also escalates here.
        if (rejection && captureUnhandledRejections) return
        observe(
            error,
            rejection ? 'onunhandledrejection' : 'onuncaughtexception',
            rejection ? 'node.process_unhandled_rejection' : 'node.process_uncaught_exception'
        )
    }
    const rejection = (reason: unknown): void =>
        observe(reason, 'onunhandledrejection', 'node.process_unhandled_rejection')
    process.on('uncaughtExceptionMonitor', monitor)
    if (captureUnhandledRejections) process.on('unhandledRejection', rejection)
    return () => {
        process.removeListener('uncaughtExceptionMonitor', monitor)
        process.removeListener('unhandledRejection', rejection)
    }
}

// An abort the app started itself and never awaited, such as a cancelled fetch. posthog-node ignores these too.
function isAbortError(reason: unknown): boolean {
    try {
        return (
            (typeof reason === 'object' || typeof reason === 'function') &&
            reason !== null &&
            (reason as { name?: unknown }).name === 'AbortError'
        )
    } catch {
        return false
    }
}
