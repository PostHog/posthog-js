import { createExceptionObserver, type ExceptionCapture } from '../shared/exception-autocapture'

export function startRendererExceptionAutocapture(canCapture: () => boolean, capture: ExceptionCapture): () => void {
    const observe = createExceptionObserver(canCapture, capture)
    const error = (event: ErrorEvent): void => {
        // Resource-load events are not JavaScript exceptions. Forward the raw ErrorEvent to core.
        if (event instanceof ErrorEvent) observe(event, 'onerror', 'browser.window_onerror')
    }
    const rejection = (event: PromiseRejectionEvent): void => {
        observe(event, 'onunhandledrejection', 'browser.unhandledrejection')
    }
    window.addEventListener('error', error)
    window.addEventListener('unhandledrejection', rejection)
    return () => {
        window.removeEventListener('error', error)
        window.removeEventListener('unhandledrejection', rejection)
    }
}
