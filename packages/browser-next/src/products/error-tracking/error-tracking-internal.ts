import type { BrowserExtension } from '../../core/context/browser-client'
import type { ExceptionAutocaptureOptions } from './error-tracking-options'

export interface ErrorTrackingExtension extends BrowserExtension {
    /**
     * Captures a handled exception as an `$exception` event. Accepts errors and any other thrown value.
     * Returns whether the event was admitted for delivery.
     */
    captureException(error: unknown, properties?: Record<string, unknown>): boolean
    /** Records a step that is attached as `$exception_steps` to exceptions captured afterwards. */
    addExceptionStep(message: string, properties?: Record<string, unknown>): void
    /** Starts automatic exception capture, overriding configured and remote settings. Defaults to errors and rejections. */
    startExceptionAutocapture(options?: true | ExceptionAutocaptureOptions): void
    /** Stops automatic exception capture, overriding configured and remote settings. */
    stopExceptionAutocapture(): void
}
