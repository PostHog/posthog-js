import { RequestQueueScaffold } from './base-request-queue'
import { encodePostData, xhr } from './send-request'
import { QueuedRequestData, RetryQueueElement } from './types'
import Config from './config'
import { RateLimiter } from './rate-limiter'

const thirtyMinutes = 30 * 60 * 1000

/**
 * Generates a jitter-ed exponential backoff delay in milliseconds
 *
 * The base value is 6 seconds, which is doubled with each retry
 * up to the maximum of 30 minutes
 *
 * Each value then has +/- 50% jitter
 *
 * Giving a range of 6 seconds up to 45 minutes
 */
export function pickNextRetryDelay(retriesPerformedSoFar: number): number {
    const rawBackoffTime = 3000 * 2 ** retriesPerformedSoFar
    const minBackoff = rawBackoffTime / 2
    const cappedBackoffTime = Math.min(thirtyMinutes, rawBackoffTime)
    const jitterFraction = Math.random() - 0.5 // A random number between -0.5 and 0.5
    const jitter = jitterFraction * (cappedBackoffTime - minBackoff)
    return Math.ceil(cappedBackoffTime + jitter)
}

export class RetryQueue extends RequestQueueScaffold {
    queue: RetryQueueElement[]
    isPolling: boolean
    areWeOnline: boolean
    onXHRError: (failedRequest: XMLHttpRequest) => void
    rateLimiter: RateLimiter

    constructor(onXHRError: (failedRequest: XMLHttpRequest) => void, rateLimiter: RateLimiter) {
        super()
        this.isPolling = false
        this.queue = []
        this.areWeOnline = true
        this.onXHRError = onXHRError
        this.rateLimiter = rateLimiter

        if (typeof window !== 'undefined' && 'onLine' in window.navigator) {
            this.areWeOnline = window.navigator.onLine
            window.addEventListener('online', () => {
                this._handleWeAreNowOnline()
            })
            window.addEventListener('offline', () => {
                this.areWeOnline = false
            })
        }
    }

    enqueue(requestData: QueuedRequestData): void {
        const retriesPerformedSoFar = requestData.retriesPerformedSoFar || 0
        if (retriesPerformedSoFar >= 10) {
            return
        }
        const msToNextRetry = pickNextRetryDelay(retriesPerformedSoFar)
        const retryAt = new Date(Date.now() + msToNextRetry)

        this.queue.push({ retryAt, requestData })
        console.warn(`Enqueued failed request for retry in ${msToNextRetry}`)
        if (!this.isPolling) {
            this.isPolling = true
            this.poll()
        }
    }

    poll(): void {
        this._poller && clearTimeout(this._poller)
        this._poller = setTimeout(() => {
            if (this.areWeOnline && this.queue.length > 0) {
                this.flush()
            }
            this.poll()
        }, this._pollInterval) as any as number
    }

    flush(): void {
        // using Date.now to make tests easier, as recommended here https://codewithhugo.com/mocking-the-current-date-in-jest-tests/
        const now = new Date(Date.now())
        const toFlush = this.queue.filter(({ retryAt }) => retryAt < now)
        if (toFlush.length > 0) {
            this.queue = this.queue.filter(({ retryAt }) => retryAt >= now)
            for (const { requestData } of toFlush) {
                this._executeXhrRequest(requestData)
            }
        }
    }

    unload(): void {
        if (this._poller) {
            clearTimeout(this._poller)
            this._poller = undefined
        }

        for (const { requestData } of this.queue) {
            const { url, data, options } = requestData

            if (this.rateLimiter.isRateLimited(options._batchKey)) {
                if (Config.DEBUG) {
                    console.warn('[PostHog RetryQueue] is quota limited. Dropping request.')
                }
                continue
            }

            try {
                // we've had send beacon in place for at least 2 years
                // eslint-disable-next-line compat/compat
                window.navigator.sendBeacon(url, encodePostData(data, { ...options, sendBeacon: true }))
            } catch (e) {
                // Note sendBeacon automatically retries, and after the first retry it will lose reference to contextual `this`.
                // This means in some cases `this.getConfig` will be undefined.
                if (Config.DEBUG) {
                    console.error(e)
                }
            }
        }
        this.queue = []
    }

    _executeXhrRequest({ url, data, options, headers, callback, retriesPerformedSoFar }: QueuedRequestData): void {
        if (this.rateLimiter.isRateLimited(options._batchKey)) {
            if (Config.DEBUG) {
                console.warn('[PostHog RetryQueue] in quota limited mode. Dropping request.')
            }
            return
        }

        xhr({
            url,
            data: data || {},
            options: options || {},
            headers: headers || {},
            retriesPerformedSoFar: retriesPerformedSoFar || 0,
            callback,
            retryQueue: this,
            onXHRError: this.onXHRError,
            onRateLimited: this.rateLimiter.on429Response,
        })
    }

    _handleWeAreNowOnline(): void {
        this.areWeOnline = true
        this.flush()
    }
}
