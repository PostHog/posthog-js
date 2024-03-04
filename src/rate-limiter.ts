import { CAPTURE_RATE_LIMIT } from './constants'
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

    constructor(instance: PostHog) {
        this.instance = instance

        this.tokensPerSecond = instance.config.rate_limiting?.events_per_second || 10
        this.burst = Math.max(
            instance.config.rate_limiting?.events_burst_limit || this.tokensPerSecond * 10,
            this.tokensPerSecond
        )

        this.bucket = {
            tokens: this.burst,
            last: new Date().getTime(),
        }
    }

    public isCaptureRateLimited(checkOnly = false): boolean {
        // This is primarily to prevent runaway loops from flooding capture with millions of events for a single user.
        // It's as much for our protection as theirs.

        const bucket = this.instance.persistence?.get_property(CAPTURE_RATE_LIMIT) ?? {
            tokens: this.burst,
            last: new Date().getTime(),
        }

        const now = new Date().getTime()
        const elapsed = now - bucket.last
        const tokensToAdd = elapsed * (this.tokensPerSecond / 1000)
        bucket.last = now
        bucket.tokens += tokensToAdd

        if (bucket.tokens > this.burst) {
            bucket.tokens = this.burst
        }

        if (bucket.tokens < 1) {
            return true
        }

        if (!checkOnly) {
            bucket.tokens = Math.max(0, bucket.tokens - 1)
        }

        this.instance.persistence?.set_property(CAPTURE_RATE_LIMIT, bucket)

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
