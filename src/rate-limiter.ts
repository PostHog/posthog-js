import { CAPTURE_RATE_LIMIT } from './constants'
import type { PostHog } from './posthog-core'
import { RequestResponse } from './types'
import { logger } from './utils/logger'

const ONE_MINUTE_IN_MILLISECONDS = 60 * 1000
const RATE_LIMIT_EVENT = '$$js_capture_client_side_rate_limited'

interface CaptureResponse {
    quota_limited?: string[]
}

export class RateLimiter {
    instance: PostHog
    serverLimits: Record<string, number> = {}

    captureEventsPerSecond: number
    captureEventsBurstLimit: number
    lastEventRateLimited = false

    constructor(instance: PostHog) {
        this.instance = instance

        this.captureEventsPerSecond = instance.config.rate_limiting?.events_per_second || 10
        this.captureEventsBurstLimit = Math.max(
            instance.config.rate_limiting?.events_burst_limit || this.captureEventsPerSecond * 10,
            this.captureEventsPerSecond
        )

        this.lastEventRateLimited = this.isCaptureClientSideRateLimited(true)
    }

    public isCaptureClientSideRateLimited(checkOnly = false): boolean {
        // This is primarily to prevent runaway loops from flooding capture with millions of events for a single user.
        // It's as much for our protection as theirs.
        const now = new Date().getTime()
        const bucket = this.instance.persistence?.get_property(CAPTURE_RATE_LIMIT) ?? {
            tokens: this.captureEventsBurstLimit,
            last: now,
        }

        bucket.tokens += ((now - bucket.last) / 1000) * this.captureEventsPerSecond
        bucket.last = now

        if (bucket.tokens > this.captureEventsBurstLimit) {
            bucket.tokens = this.captureEventsBurstLimit
        }

        const isRateLimited = bucket.tokens < 1

        if (!isRateLimited && !checkOnly) {
            bucket.tokens = Math.max(0, bucket.tokens - 1)
        }

        if (isRateLimited && !this.lastEventRateLimited && !checkOnly) {
            this.instance.capture(
                RATE_LIMIT_EVENT,
                {
                    $js_config_rate_limiting_events_per_second: this.captureEventsPerSecond,
                    $js_config_rate_limiting_events_burst_limit: this.captureEventsBurstLimit,
                },
                {
                    skip_client_rate_limiting: true,
                }
            )
        }

        this.lastEventRateLimited = isRateLimited
        this.instance.persistence?.set_property(CAPTURE_RATE_LIMIT, bucket)

        return isRateLimited
    }

    public isServerRateLimited(batchKey: string | undefined): boolean {
        const retryAfter = this.serverLimits[batchKey || 'events'] || false

        if (retryAfter === false) {
            return false
        }
        return new Date().getTime() < retryAfter
    }

    public checkForLimiting = (httpResponse: RequestResponse): void => {
        const text = httpResponse.text

        if (!text || !text.length) {
            return
        }

        try {
            const response: CaptureResponse = JSON.parse(text)
            const quotaLimitedProducts = response.quota_limited || []
            quotaLimitedProducts.forEach((batchKey) => {
                logger.info(`[RateLimiter] ${batchKey || 'events'} is quota limited.`)
                this.serverLimits[batchKey] = new Date().getTime() + ONE_MINUTE_IN_MILLISECONDS
            })
        } catch (e: any) {
            logger.warn(`[RateLimiter] could not rate limit - continuing. Error: "${e?.message}"`, { text })
            return
        }
    }
}
