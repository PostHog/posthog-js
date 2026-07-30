import { CAPTURE_RATE_LIMIT, CAPTURE_RATE_LIMIT_DROPPED } from './constants'
import type { PostHog } from './posthog-core'
import { RequestResponse } from './types'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { location } from '@posthog/browser-common/utils/globals'

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

        if (isRateLimited && !checkOnly) {
            // Count every drop, not just the ones in this page's lifetime: a runaway loop that reloads
            // the page loses the in-memory state, so the counter is persisted and reported (then reset)
            // by the next warning. It is a rolling "dropped since the last warning" tally.
            const droppedSinceLastWarning = this._droppedWhileLimited() + 1
            this.instance.persistence?.set_property(CAPTURE_RATE_LIMIT_DROPPED, droppedSinceLastWarning)

            if (!this.lastEventRateLimited) {
                this.instance.persistence?.set_property(CAPTURE_RATE_LIMIT_DROPPED, 0)
                this._captureWarning(droppedSinceLastWarning)
            }
        }

        this.lastEventRateLimited = isRateLimited
        this.instance.persistence?.set_property(CAPTURE_RATE_LIMIT, bucket)

        return {
            isRateLimited,
            remainingTokens: bucket.tokens,
        }
    }

    private _droppedWhileLimited(): number {
        const dropped = this.instance.persistence?.get_property(CAPTURE_RATE_LIMIT_DROPPED)
        return typeof dropped === 'number' && dropped > 0 ? dropped : 0
    }

    /**
     * The page the limiter tripped on, without the query string or hash - enough to spot a
     * self-reloading 404 without putting whatever a customer keeps in their query params into
     * an ingestion warning.
     */
    private _triggeringPage(): string | undefined {
        if (!location?.pathname) {
            return undefined
        }
        return `${location.origin ?? ''}${location.pathname}`
    }

    private _captureWarning(droppedSinceLastWarning: number): void {
        const { captureEventsBurstLimit, captureEventsPerSecond } = this
        const page = this._triggeringPage()
        const sessionId = this.instance.get_session_id?.()

        // Only `$$client_ingestion_warning_message` survives into the ingestion warning the
        // customer actually sees, so the diagnostics have to be in the string as well as in
        // properties on the event.
        const context = [
            `${droppedSinceLastWarning} event(s) dropped since the last warning`,
            page ? `triggered on ${page}` : undefined,
            sessionId ? `session ${sessionId}` : undefined,
        ]
            .filter(Boolean)
            .join(', ')

        this.instance.capture(
            RATE_LIMIT_EVENT,
            {
                $$client_ingestion_warning_message: `posthog-js client rate limited: ${context}. Config is set to ${captureEventsPerSecond} events per second and ${captureEventsBurstLimit} events burst limit.`,
                $$client_ingestion_warning_dropped_events: droppedSinceLastWarning,
                $$client_ingestion_warning_page: page,
                $$client_ingestion_warning_session_id: sessionId,
                $$client_ingestion_warning_events_per_second: captureEventsPerSecond,
                $$client_ingestion_warning_events_burst_limit: captureEventsBurstLimit,
            },
            {
                skip_client_rate_limiting: true,
            }
        )
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
