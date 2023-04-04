import { RequestQueueScaffold } from './base-request-queue'
import { encodePostData, xhr } from './send-request'
import { CaptureMetrics } from './capture-metrics'
import { QueuedRequestData, RetryQueueElement } from './types'
import Config from './config'

export class RetryQueue extends RequestQueueScaffold {
    captureMetrics: CaptureMetrics
    queue: RetryQueueElement[]
    isPolling: boolean
    areWeOnline: boolean
    onXHRError: (failedRequest: XMLHttpRequest) => void

    constructor(captureMetrics: CaptureMetrics, onXHRError: (failedRequest: XMLHttpRequest) => void) {
        super()
        this.captureMetrics = captureMetrics
        this.isPolling = false
        this.queue = []
        this.areWeOnline = true
        this.onXHRError = onXHRError

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
        const msToNextRetry = 3000 * 2 ** retriesPerformedSoFar
        const retryAt = new Date(Date.now() + msToNextRetry)
        console.warn(`Enqueued failed request for retry in ${msToNextRetry}`)
        this.queue.push({ retryAt, requestData })
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
        // using Date.now to make tests easier as recommended here https://codewithhugo.com/mocking-the-current-date-in-jest-tests/
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
            try {
                window.navigator.sendBeacon(url, encodePostData(data, { ...options, sendBeacon: true }))
            } catch (e) {
                // Note sendBeacon automatically retries, and after the first retry it will loose reference to contextual `this`.
                // This means in some cases `this.getConfig` will be undefined.
                if (Config.DEBUG) {
                    console.error(e)
                }
            }
        }
        this.queue = []
    }

    _executeXhrRequest({ url, data, options, headers, callback, retriesPerformedSoFar }: QueuedRequestData): void {
        xhr({
            url,
            data: data || {},
            options: options || {},
            headers: headers || {},
            retriesPerformedSoFar: retriesPerformedSoFar || 0,
            callback,
            captureMetrics: this.captureMetrics,
            retryQueue: this,
            onXHRError: this.onXHRError,
        })
    }

    _handleWeAreNowOnline(): void {
        this.areWeOnline = true
        this.flush()
    }
}
