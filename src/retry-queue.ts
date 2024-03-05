import { RequestQueueScaffold } from './base-request-queue'
import { RetriableRequestOptions } from './types'

import { _isNumber, _isUndefined } from './utils/type-utils'
import { logger } from './utils/logger'
import { window } from './utils/globals'
import { PostHog } from './posthog-core'
import { addParamsToURL } from './request'

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

interface RetryQueueElement {
    retryAt: Date
    requestOptions: RetriableRequestOptions
}

export class RetryQueue extends RequestQueueScaffold {
    queue: RetryQueueElement[]
    isPolling: boolean
    areWeOnline: boolean

    constructor(private instance: PostHog) {
        super()
        this.isPolling = false
        this.queue = []
        this.areWeOnline = true

        if (!_isUndefined(window) && 'onLine' in window.navigator) {
            this.areWeOnline = window.navigator.onLine
            window.addEventListener('online', () => {
                this.areWeOnline = true
                this.flush()
            })
            window.addEventListener('offline', () => {
                this.areWeOnline = false
            })
        }
    }

    retriableRequest({ retriesPerformedSoFar, ...options }: RetriableRequestOptions): void {
        if (_isNumber(retriesPerformedSoFar) && retriesPerformedSoFar > 0) {
            options.url = addParamsToURL(options.url, { retry_count: retriesPerformedSoFar })
        }

        this.instance._send_request({
            ...options,
            callback: (response) => {
                if (response.statusCode !== 200 && (response.statusCode < 400 || response.statusCode > 500)) {
                    this.enqueue({
                        ...options,
                        retriesPerformedSoFar: (retriesPerformedSoFar || 0) + 1,
                    })
                }

                options.callback?.(response)
            },
        })
    }

    private enqueue(requestOptions: RetriableRequestOptions): void {
        const retriesPerformedSoFar = requestOptions.retriesPerformedSoFar || 0
        if (retriesPerformedSoFar >= 10) {
            return
        }
        const msToNextRetry = pickNextRetryDelay(retriesPerformedSoFar)
        const retryAt = new Date(Date.now() + msToNextRetry)

        this.queue.push({ retryAt, requestOptions })

        let logMessage = `Enqueued failed request for retry in ${msToNextRetry}`
        if (!navigator.onLine) {
            logMessage += ' (Browser is offline)'
        }
        logger.warn(logMessage)

        if (!this.isPolling) {
            this.isPolling = true
            this.poll()
        }
    }

    private poll(): void {
        this._poller && clearTimeout(this._poller)
        this._poller = setTimeout(() => {
            if (this.areWeOnline && this.queue.length > 0) {
                this.flush()
            }
            this.poll()
        }, this._pollInterval) as any as number
    }

    private flush(): void {
        // using Date.now to make tests easier, as recommended here https://codewithhugo.com/mocking-the-current-date-in-jest-tests/
        const now = new Date(Date.now())
        const toFlush = this.queue.filter(({ retryAt }) => retryAt < now)
        if (toFlush.length > 0) {
            this.queue = this.queue.filter(({ retryAt }) => retryAt >= now)
            for (const { requestOptions } of toFlush) {
                this.retriableRequest(requestOptions)
            }
        }
    }

    unload(): void {
        if (this._poller) {
            clearTimeout(this._poller)
            this._poller = undefined
        }

        for (const { requestOptions } of this.queue) {
            try {
                // we've had send beacon in place for at least 2 years
                // eslint-disable-next-line compat/compat
                this.instance._send_request({
                    ...requestOptions,
                    transport: 'sendBeacon',
                })
            } catch (e) {
                // Note sendBeacon automatically retries, and after the first retry it will lose reference to contextual `this`.
                // This means in some cases `this.getConfig` will be undefined.
                logger.error(e)
            }
        }
        this.queue = []
    }
}
