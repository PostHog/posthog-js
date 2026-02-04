import { CAPTURE_RATE_LIMIT } from './constants'
import type { PostHog } from './posthog-core'
import { RequestResponse } from './types'
import { createLogger } from './utils/logger'

const logger = createLogger('[RateLimiter]')

const ONE_MINUTE_IN_MILLISECONDS = 60 * 1000
const RATE_LIMIT_EVENT = '$$client_ingestion_warning'
const DEFAULT_EVENTS_PER_SECOND = 10
const BURST_LIMIT_MULTIPLIER = 10

interface CaptureResponse {
    quota_limited?: string[]
}

export class RateLimiter {
    instance: PostHog
    serverLimits: Record<string, number> = {}
    lastEventRateLimited = false

    constructor(instance: PostHog) {
        this.instance = instance
        this.lastEventRateLimited = this.clientRateLimitContext(true).isRateLimited
    }

    get captureEventsPerSecond(): number {
        return this.instance.config.rate_limiting?.events_per_second || DEFAULT_EVENTS_PER_SECOND
    }

    get captureEventsBurstLimit(): number {
        return Math.max(
            this.instance.config.rate_limiting?.events_burst_limit ||
                this.captureEventsPerSecond * BURST_LIMIT_MULTIPLIER,
            this.captureEventsPerSecond
        )
    }

    public clientRateLimitContext(checkOnly = false): {
        isRateLimited: boolean
        remainingTokens: number
    } {
        // This is primarily to prevent runaway loops from flooding capture with millions of events for a single user.
        // It's as much for our protection as theirs.
        const { captureEventsBurstLimit, captureEventsPerSecond } = this
        const now = new Date().getTime()
        const bucket = this.instance.persistence?.get_property(CAPTURE_RATE_LIMIT) ?? {
            tokens: captureEventsBurstLimit,
            last: now,
        }

        bucket.tokens += ((now - bucket.last) / 1000) * captureEventsPerSecond
        bucket.last = now

        if (bucket.tokens > captureEventsBurstLimit) {
            bucket.tokens = captureEventsBurstLimit
        }

        const isRateLimited = bucket.tokens < 1

        if (!isRateLimited && !checkOnly) {
            bucket.tokens = Math.max(0, bucket.tokens - 1)
        }

        if (isRateLimited && !this.lastEventRateLimited && !checkOnly) {
            this.instance.capture(
                RATE_LIMIT_EVENT,
                {
                    $$client_ingestion_warning_message: `posthog-js client rate limited. Config is set to ${captureEventsPerSecond} events per second and ${captureEventsBurstLimit} events burst limit.`,
                },
                {
                    skip_client_rate_limiting: true,
                }
            )
        }

        this.lastEventRateLimited = isRateLimited
        this.instance.persistence?.set_property(CAPTURE_RATE_LIMIT, bucket)

        return {
            isRateLimited,
            remainingTokens: bucket.tokens,
        }
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
                logger.info(`${batchKey || 'events'} is quota limited.`)
                this.serverLimits[batchKey] = new Date().getTime() + ONE_MINUTE_IN_MILLISECONDS
            })
        } catch (e: any) {
            logger.warn(`could not rate limit - continuing. Error: "${e?.message}"`, { text })
            return
        }
    }
}
