/** Sources of automatically captured exceptions. Omitted sources are not captured. */
export interface ExceptionAutocaptureOptions {
    /** Capture errors that reach `window.onerror`. */
    captureUnhandledErrors?: boolean
    /** Capture promise rejections that reach `window.onunhandledrejection`. */
    captureUnhandledRejections?: boolean
    /** Capture `console.error` calls. */
    captureConsoleErrors?: boolean
}

export interface ExceptionStepsOptions {
    /** Record steps and attach them to captured exceptions. Defaults to `true`. */
    enabled?: boolean
    /** UTF-8 byte budget of buffered steps; the oldest steps are evicted first. Defaults to 32,768. */
    maxBytes?: number
}

export interface ErrorTrackingOptions {
    /**
     * Automatic exception capture. `true` captures unhandled errors and rejections, an object selects
     * sources, and `false` disables it. Omitted, the project's remote configuration decides.
     */
    captureExceptions?: boolean | ExceptionAutocaptureOptions
    /**
     * Capture exceptions thrown by browser extensions or by scripts the browser injects into the page.
     * Omitted, the project's remote configuration decides, defaulting to `false`.
     */
    captureExtensionExceptions?: boolean
    /** Exception steps added with `addExceptionStep()`. */
    exceptionSteps?: ExceptionStepsOptions
    /** Tokens refilled every ten seconds for each automatically captured exception type, from 0 to the bucket size. Defaults to 1. */
    exceptionRateLimiterRefillRate?: number
    /**
     * Token bucket size for each automatically captured exception type, from 0 to 100. Defaults to 10. The exception
     * that empties the bucket is limited, so a full bucket admits one fewer exception than its size.
     */
    exceptionRateLimiterBucketSize?: number
}

export type ErrorTrackingConfiguration = false | ErrorTrackingOptions

/** Snapshot caller-owned nested option objects. */
export const snapshotErrorTrackingOptions = (options: ErrorTrackingOptions = {}): ErrorTrackingOptions => ({
    ...options,
    ...(options.captureExceptions && typeof options.captureExceptions === 'object'
        ? { captureExceptions: { ...options.captureExceptions } }
        : {}),
    ...(options.exceptionSteps ? { exceptionSteps: { ...options.exceptionSteps } } : {}),
})
