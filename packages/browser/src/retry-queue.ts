import { RetriableRequestWithOptions } from './types'

import { isNumber, isUndefined } from '@posthog/core'
import { logger } from './utils/logger'
import { window } from './utils/globals'
import { PostHog } from './posthog-core'
import { extendURLParams } from './request'
import { addEventListener } from './utils'

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
    requestOptions: RetriableRequestWithOptions
}

export class RetryQueue {
    private _isPolling: boolean = false
    private _poller: number | undefined
    private _pollIntervalMs: number = 3000
    private _queue: RetryQueueElement[] = []
    private _areWeOnline: boolean
    private _onlineListener: (() => void) | undefined
    private _offlineListener: (() => void) | undefined

    constructor(private _instance: PostHog) {
        this._queue = []
        this._areWeOnline = true

        if (!isUndefined(window) && 'onLine' in window.navigator) {
            this._areWeOnline = window.navigator.onLine

            this._onlineListener = () => {
                this._areWeOnline = true
                this._flush()
            }

            this._offlineListener = () => {
                this._areWeOnline = false
            }

            addEventListener(window, 'online', this._onlineListener)
            addEventListener(window, 'offline', this._offlineListener)
        }
    }

    get length() {
        return this._queue.length
    }

    retriableRequest({ retriesPerformedSoFar, ...options }: RetriableRequestWithOptions): void {
        if (isNumber(retriesPerformedSoFar) && retriesPerformedSoFar > 0) {
            options.url = extendURLParams(options.url, { retry_count: retriesPerformedSoFar })
        }

        this._instance._send_request({
            ...options,
            callback: (response) => {
                if (response.statusCode !== 200 && (response.statusCode < 400 || response.statusCode >= 500)) {
                    if ((retriesPerformedSoFar ?? 0) < 10) {
                        this._enqueue({
                            retriesPerformedSoFar,
                            ...options,
                        })
                        return
                    }
                }

                options.callback?.(response)
            },
        })
    }

    private _enqueue(requestOptions: RetriableRequestWithOptions): void {
        const retriesPerformedSoFar = requestOptions.retriesPerformedSoFar || 0
        requestOptions.retriesPerformedSoFar = retriesPerformedSoFar + 1

        const msToNextRetry = pickNextRetryDelay(retriesPerformedSoFar)
        const retryAt = Date.now() + msToNextRetry

        this._queue.push({ retryAt, requestOptions })

        let logMessage = `Enqueued failed request for retry in ${msToNextRetry}`
        if (!navigator.onLine) {
            logMessage += ' (Browser is offline)'
        }
        logger.warn(logMessage)

        if (!this._isPolling) {
            this._isPolling = true
            this._poll()
        }
    }

    private _poll(): void {
        this._poller && clearTimeout(this._poller)

        if (this._queue.length === 0) {
            this._isPolling = false
            this._poller = undefined
            return
        }

        this._poller = setTimeout(() => {
            if (this._areWeOnline && this._queue.length > 0) {
                this._flush()
            }
            this._poll()
        }, this._pollIntervalMs) as any as number
    }

    private _flush(): void {
        const now = Date.now()
        const notToFlush: RetryQueueElement[] = []
        const toFlush = this._queue.filter((item) => {
            if (item.retryAt < now) {
                return true
            }
            notToFlush.push(item)
            return false
        })

        this._queue = notToFlush

        if (toFlush.length > 0) {
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

        this._isPolling = false

        if (!isUndefined(window)) {
            if (this._onlineListener) {
                window.removeEventListener('online', this._onlineListener)
                this._onlineListener = undefined
            }
            if (this._offlineListener) {
                window.removeEventListener('offline', this._offlineListener)
                this._offlineListener = undefined
            }
        }

        for (const { requestOptions } of this._queue) {
            try {
                // we've had send beacon in place for at least 2 years
                // eslint-disable-next-line compat/compat
                this._instance._send_request({
                    ...requestOptions,
                    transport: 'sendBeacon',
                })
            } catch (e) {
                // Note sendBeacon automatically retries, and after the first retry it will lose reference to contextual `this`.
                // This means in some cases `this.getConfig` will be undefined.
                logger.error(e)
            }
        }
        this._queue = []
    }
}
