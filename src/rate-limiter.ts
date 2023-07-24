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
    constructor(private persistence: PostHogPersistence) {}

    isRateLimited(batchKey: string | undefined): boolean {
        const limits = this.persistence.get_quota_limits()
        const retryAfter = limits[batchKey || 'events'] || false

        if (retryAfter === false) {
            return false
        }
        return new Date().getTime() < retryAfter
    }

    on429Response(response: XMLHttpRequest): void {
        if (response.status !== 429) {
            return
        }

        const newLimits = { ...this.persistence.get_quota_limits() }

        Object.entries(supportedRetryHeaders).forEach(([header, batchKey]) => {
            const responseHeader = response.getResponseHeader(header)
            if (!responseHeader) {
                return
            }

            const retryAfterSeconds = parseInt(responseHeader, 10)
            if (retryAfterSeconds) {
                const retryAfterMillis = retryAfterSeconds * 1000
                newLimits[batchKey] = new Date().getTime() + retryAfterMillis
            }
        })

        this.persistence.set_quota_limits(newLimits)
    }
}
