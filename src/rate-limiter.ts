import { SESSION_RECORDING_BATCH_KEY } from './extensions/sessionrecording'
import { logger } from './utils'

const oneMinuteInMilliseconds = 60 * 1000

interface CaptureResponse {
    quota_limited?: string[]
}

export class RateLimiter {
    limits: Record<string, number> = {}

    constructor(private checkThreshold = 0.1) {}

    isRateLimited(batchKey: string | undefined): boolean {
        const retryAfter = this.limits[batchKey || 'events'] || false

        if (retryAfter === false) {
            return false
        }
        return new Date().getTime() < retryAfter
    }

    checkForLimiting(xmlHttpRequest: XMLHttpRequest): void {
        if (Math.random() >= this.checkThreshold) {
            // we don't need to check this on every request
            return
        }

        let response: CaptureResponse
        try {
            response = JSON.parse(xmlHttpRequest.responseText)
            const quotaLimitedProducts = response.quota_limited || []
            quotaLimitedProducts.forEach((batchKey) => {
                this.limits[batchKey] = new Date().getTime() + oneMinuteInMilliseconds
            })
        } catch (e) {
            logger.error(e)
            return
        }
    }
}
