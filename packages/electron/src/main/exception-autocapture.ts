import type { ExceptionCapture } from '../shared/exception-autocapture'
import { createExceptionObserver } from '../shared/exception-autocapture'

/** Monitor only: a rejection listener would change Node's default throw/exit behavior. */
export function startProcessExceptionAutocapture(canCapture: () => boolean, capture: ExceptionCapture): () => void {
    const observe = createExceptionObserver(canCapture, capture)
    const monitor = (error: Error, origin: NodeJS.UncaughtExceptionOrigin): void => {
        const rejection = origin === 'unhandledRejection'
        observe(
            error,
            rejection ? 'onunhandledrejection' : 'onuncaughtexception',
            rejection ? 'node.process_unhandled_rejection' : 'node.process_uncaught_exception'
        )
    }
    process.on('uncaughtExceptionMonitor', monitor)
    return () => process.removeListener('uncaughtExceptionMonitor', monitor)
}
