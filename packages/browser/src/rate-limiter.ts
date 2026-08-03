import { CAPTURE_RATE_LIMIT } from './constants'
import type { PostHog } from './posthog-core'
import { RequestResponse } from './types'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { location } from '@posthog/browser-common/utils/globals'
import { isArray, isNumber } from '@posthog/core'

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
            // the page loses the in-memory state, so the tally lives on the persisted bucket and is
            // reported (then reset) by the next warning - "dropped since the last warning".
            const droppedSinceLastWarning = (isNumber(bucket.dropped) ? bucket.dropped : 0) + 1
            bucket.dropped = droppedSinceLastWarning

            if (!this.lastEventRateLimited && this._captureWarning(droppedSinceLastWarning)) {
                // `capture` returns the accepted event after the full local pipeline has run. Keep
                // the tally when (for example) `before_send` rejects the warning so the next
                // accepted warning still accounts for every dropped event.
                bucket.dropped = 0
            }
        }

        this.lastEventRateLimited = isRateLimited
        this.instance.persistence?.set_property(CAPTURE_RATE_LIMIT, bucket)

        return {
            isRateLimited,
            remainingTokens: bucket.tokens,
        }
    }

    private _isPropertyAllowed(property: string): boolean {
        const denylist = this.instance.config.property_denylist
        return !isArray(denylist) || !denylist.includes(property)
    }

    /**
     * The page the limiter tripped on, without the query string or hash - enough to spot a
     * self-reloading 404 without putting whatever a customer keeps in their query params into
     * an ingestion warning. Because this value recombines `$current_url` and `$pathname`, omit it
     * if either standard property has been denylisted rather than reintroducing denied context.
     */
    private _triggeringPage(): string | undefined {
        if (!this._isPropertyAllowed('$current_url') || !this._isPropertyAllowed('$pathname') || !location?.pathname) {
            return undefined
        }
        return `${location.origin ?? ''}${location.pathname}`
    }

    private _captureWarning(droppedSinceLastWarning: number): boolean {
        const { captureEventsBurstLimit, captureEventsPerSecond } = this
        const page = this._triggeringPage()
        const sessionId = this._isPropertyAllowed('$session_id') ? this.instance.get_session_id?.() : undefined

        // Ingestion currently retains only this message for client ingestion warnings. Keep the
        // diagnostics here instead of adding structured properties that the backend discards.
        const context = [
            `${droppedSinceLastWarning} event(s) dropped since the last warning`,
            page ? `triggered on ${page}` : undefined,
            sessionId ? `session ${sessionId}` : undefined,
        ]
            .filter(Boolean)
            .join(', ')

        return !!this.instance.capture(
            RATE_LIMIT_EVENT,
            {
                $$client_ingestion_warning_message: `posthog-js client rate limited: ${context}. Config is set to ${captureEventsPerSecond} events per second and ${captureEventsBurstLimit} events burst limit.`,
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
