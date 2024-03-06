import { RetriableRequestOptions } from './types'

import { _isNumber, _isUndefined } from './utils/type-utils'
import { logger } from './utils/logger'
import { window } from './utils/globals'
import { PostHog } from './posthog-core'
import { extendURLParams } from './request'

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
    retryAt: number
    requestOptions: RetriableRequestOptions
}

export class RetryQueue {
    private isPolling: boolean = false // flag to continue to recursively poll or not
    private poller: number | undefined // to become interval for reference to clear later
    private pollIntervalMs: number = 3000
    private queue: RetryQueueElement[] = []
    private areWeOnline: boolean

    constructor(private instance: PostHog) {
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
            options.url = extendURLParams(options.url, { retry_count: retriesPerformedSoFar })
        }

        this.instance._send_request({
            ...options,
            callback: (response) => {
                if (response.statusCode !== 200 && (response.statusCode < 400 || response.statusCode > 500)) {
                    this.enqueue({
                        ...options,
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

        requestOptions.retriesPerformedSoFar = retriesPerformedSoFar + 1

        const msToNextRetry = pickNextRetryDelay(retriesPerformedSoFar)
        const retryAt = Date.now() + msToNextRetry

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
        this.poller && clearTimeout(this.poller)
        this.poller = setTimeout(() => {
            if (this.areWeOnline && this.queue.length > 0) {
                this.flush()
            }
            this.poll()
        }, this.pollIntervalMs) as any as number
    }

    private flush(): void {
        const now = Date.now()
        const notToFlush: RetryQueueElement[] = []
        const toFlush = this.queue.filter((item) => {
            if (item.retryAt < now) {
                return true
            }
            notToFlush.push(item)
            return false
        })

        this.queue = notToFlush

        if (toFlush.length > 0) {
            for (const { requestOptions } of toFlush) {
                this.retriableRequest(requestOptions)
            }
        }
    }

    unload(): void {
        if (this.poller) {
            clearTimeout(this.poller)
            this.poller = undefined
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
