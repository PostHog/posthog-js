import { PostHogPersistence } from './posthog-persistence'
import { SESSION_RECORDING_BATCH_KEY, SessionRecording } from './extensions/sessionrecording'

/**
 * Really a 429 response should have a `Retry-After` header which is either a date string,
 * or the number of seconds to wait before retrying
 *
 * But we can rate limit endpoints differently, so send custom header per endpoint
 * The endpoints are configurable, so we tie the headers/retries to specific batch keys
 *
 * And only support a number of seconds to wait before retrying
 */
const supportedRetryHeaders = {
    'X-PostHog-Retry-After-Recordings': SESSION_RECORDING_BATCH_KEY,
    'X-PostHog-Retry-After-Events': 'events',
}

export class RateLimiter {
    limits: Record<string, number> = {}

    isRateLimited(batchKey: string | undefined): boolean {
        const retryAfter = this.limits[batchKey || 'events'] || false

        if (retryAfter === false) {
            return false
        }
        return new Date().getTime() < retryAfter
    }

    on429Response(response: XMLHttpRequest): void {
        if (response.status !== 429) {
            return
        }

        Object.entries(supportedRetryHeaders).forEach(([header, batchKey]) => {
            const responseHeader = response.getResponseHeader(header)
            if (!responseHeader) {
                return
            }

            let retryAfterSeconds = parseInt(responseHeader, 10)
            if (isNaN(retryAfterSeconds)) {
                retryAfterSeconds = 60
            }

            if (retryAfterSeconds) {
                const retryAfterMillis = retryAfterSeconds * 1000
                this.limits[batchKey] = new Date().getTime() + retryAfterMillis
            }
        })
    }
}
