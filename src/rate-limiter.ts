import { logger } from './utils/logger'

const oneMinuteInMilliseconds = 60 * 1000

interface CaptureResponse {
    quota_limited?: string[]
}

export class RateLimiter {
    limits: Record<string, number> = {}

    public isRateLimited(batchKey: string | undefined): boolean {
        const retryAfter = this.limits[batchKey || 'events'] || false

        if (retryAfter === false) {
            return false
        }
        return new Date().getTime() < retryAfter
    }

    public checkForLimiting = (xmlHttpRequest: XMLHttpRequest): void => {
        try {
            const text = xmlHttpRequest.responseText
            if (!text || !text.length) {
                return
            }

            const response: CaptureResponse = JSON.parse(text)
            const quotaLimitedProducts = response.quota_limited || []
            quotaLimitedProducts.forEach((batchKey) => {
                logger.info(`[RateLimiter] ${batchKey || 'events'} is quota limited.`)
                this.limits[batchKey] = new Date().getTime() + oneMinuteInMilliseconds
            })
        } catch (e) {
            logger.error(e)
            return
        }
    }
}
