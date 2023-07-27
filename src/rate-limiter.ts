import { logger } from './utils'
import Config from './config'

const oneMinuteInMilliseconds = 60 * 1000

interface CaptureResponse {
    quota_limited?: string[]
}

export class RateLimiter {
    limits: Record<string, number> = {}
    private checkThreshold: number

    constructor(checkThreshold = 0.1) {
        this.checkThreshold = checkThreshold
    }

    public isRateLimited(batchKey: string | undefined): boolean {
        const retryAfter = this.limits[batchKey || 'events'] || false

        if (retryAfter === false) {
            return false
        }
        return new Date().getTime() < retryAfter
    }

    // this needs to be an arrow function so that it can be passed as a callback
    // and have the correct `this` context in order to read `checkThreshold`
    public checkForLimiting = (xmlHttpRequest: XMLHttpRequest): void => {
        if (Math.random() >= this.checkThreshold) {
            // we don't need to check this on every request
            return
        }

        let response: CaptureResponse
        try {
            response = JSON.parse(xmlHttpRequest.responseText)
            const quotaLimitedProducts = response.quota_limited || []
            quotaLimitedProducts.forEach((batchKey) => {
                if (Config.DEBUG) {
                    console.warn(`[PostHog RateLimiter] ${batchKey || 'events'} is quota limited.`)
                }
                this.limits[batchKey] = new Date().getTime() + oneMinuteInMilliseconds
            })
        } catch (e) {
            logger.error(e)
            return
        }
    }
}
