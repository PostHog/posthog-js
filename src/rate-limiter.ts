import type { PostHog } from './posthog-core'
import { MinimalHTTPResponse } from './types'
import { logger } from './utils/logger'

const oneMinuteInMilliseconds = 60 * 1000

interface CaptureResponse {
    quota_limited?: string[]
}

export class RateLimiter {
    instance: PostHog
    serverLimits: Record<string, number> = {}

    tokensPerSecond: number
    burst: number
    bucket: {
        tokens: number
        last: number
    }

    constructor(instance: PostHog, options?: { tokensPerSecond?: number; burst?: number }) {
        this.instance = instance

        this.tokensPerSecond = options?.tokensPerSecond || 10
        this.burst = options?.burst || 100

        this.bucket = {
            tokens: this.bucketLimit,
            last: new Date().getTime(),
        }
    }

    private get bucketLimit() {
        return this.burst + this.tokensPerSecond
    }

    public isCaptureRateLimited(checkOnly = false): boolean {
        // This is primarily to prevent runaway loops from flooding capture with millions of events for a single user.
        // It's as much for our protection as theirs.
        const now = new Date().getTime()
        const elapsed = now - this.bucket.last
        const tokensToAdd = elapsed * (this.tokensPerSecond / 1000)
        this.bucket.last = now
        this.bucket.tokens += tokensToAdd

        if (this.bucket.tokens > this.bucketLimit) {
            this.bucket.tokens = this.bucketLimit
        }

        if (this.bucket.tokens < 1) {
            return true
        }

        if (!checkOnly) {
            this.bucket.tokens = Math.max(0, this.bucket.tokens - 1)
        }

        return false
    }

    public isServerRateLimited(batchKey: string | undefined): boolean {
        const retryAfter = this.serverLimits[batchKey || 'events'] || false

        if (retryAfter === false) {
            return false
        }
        return new Date().getTime() < retryAfter
    }

    public checkForLimiting = (httpResponse: MinimalHTTPResponse): void => {
        const text: string | undefined = httpResponse.responseText

        if (!text || !text.length) {
            return
        }

        try {
            const response: CaptureResponse = JSON.parse(text)
            const quotaLimitedProducts = response.quota_limited || []
            quotaLimitedProducts.forEach((batchKey) => {
                logger.info(`[RateLimiter] ${batchKey || 'events'} is quota limited.`)
                this.serverLimits[batchKey] = new Date().getTime() + oneMinuteInMilliseconds
            })
        } catch (e: any) {
            logger.warn(`[RateLimiter] could not rate limit - continuing. Error: "${e?.message}"`, { text })
            return
        }
    }
}
