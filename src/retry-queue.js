import { RequestQueueScaffold } from './base-request-queue'
import { encodePostData, xhr } from './send-request'

export class RetryQueue extends RequestQueueScaffold {
    constructor(captureMetrics) {
        super()
        this.captureMetrics = captureMetrics
        this.isPolling = false
        this.queue = []
        this.areWeOnline = true

        if ('onLine' in window.navigator) {
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

    enqueue(requestData) {
        const { retriesPerformedSoFar } = requestData
        if (retriesPerformedSoFar >= 10) {
            return
        }
        const retryAt = new Date(new Date().valueOf() + 2 ** retriesPerformedSoFar * 3000)
        this.queue.push({ retryAt, requestData })

        if (!this.isPolling) {
            this.isPolling = true
            this.poll()
        }
    }

    poll() {
        clearTimeout(this._poller)
        this._poller = setTimeout(() => {
            if (this.areWeOnline && this.queue.length > 0) {
                this.flush()
            }
            this.poll()
        }, this._pollInterval)
    }

    flush() {
        const now = new Date().valueOf()
        const toFlush = this.queue.filter(({ retryAt }) => retryAt < now)
        if (toFlush.length > 0) {
            this.queue = this.queue.filter(({ retryAt }) => retryAt >= now)
            for (const { requestData } of toFlush) {
                this._executeXhrRequest(requestData)
            }
        }
    }

    unload() {
        clearTimeout(this._poller)
        for (const { requestData } of this.queue) {
            const { url, data, options } = requestData
            window.navigator.sendBeacon(url, encodePostData(data, { ...options, sendBeacon: true }))
        }
        this.queue = []
    }

    _executeXhrRequest({ url, data, options, headers, callback, retryNumber }) {
        xhr({
            url,
            data: data || {},
            options: options || {},
            headers: headers || {},
            retryNumber: retryNumber || 0,
            callback,
            captureMetrics: this.captureMetrics,
            retryQueue: this,
        })
    }
}
