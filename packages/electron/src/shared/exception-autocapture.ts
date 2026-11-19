import { BucketedRateLimiter, createLogger, resolveExceptionRateLimiterConfig } from '@posthog/core/utils'
import type { EventHint } from '@posthog/core/error-tracking'

export type ExceptionCapture = (
    error: unknown,
    properties: { $exception_source: string },
    hint: EventHint
) => Promise<void>

/** Never let reporting failures escape a runtime's global error dispatch. */
export function createExceptionObserver(
    canCapture: () => boolean,
    capture: ExceptionCapture
): (error: unknown, mechanism: string, source: string) => void {
    const limiter = new BucketedRateLimiter({
        ...resolveExceptionRateLimiterConfig(),
        refillInterval: 1000,
        _logger: createLogger('[PostHog]', () => {}),
    })
    let capturing = false
    return (error, mechanism, source) => {
        try {
            // Check consent before inspecting any part of the error, even its type or message.
            if (capturing || !canCapture() || limiter.consumeRateLimit('exceptions')) return
            capturing = true
            try {
                void capture(
                    error,
                    { $exception_source: source },
                    { mechanism: { type: mechanism, handled: false } }
                ).catch(() => {})
            } finally {
                capturing = false
            }
        } catch {
            // Error accessors, IPC and consumer hooks may all fail while reporting.
        }
    }
}
