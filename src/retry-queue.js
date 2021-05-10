import { RequestQueueScaffold } from './base-request-queue'
import { encodePostData, xhr } from './send-request'

export class RetryQueue extends RequestQueueScaffold {
    constructor(captureMetrics) {
        super()
        this._requestRetriesMap = new Map() // <RequestId, number>
        this.captureMetrics = captureMetrics
    }

    enqueue(requestData) {
        const { requestId } = requestData
        if (!this._requestRetriesMap.has(requestId)) {
            this._requestRetriesMap.set(requestId, 0)
        } else {
            const retriesPerformedSoFar = this._requestRetriesMap.get(requestId)
            if (retriesPerformedSoFar === 2) {
                this._requestRetriesMap.delete(requestId)
                return
            }
            this._requestRetriesMap.set(requestId, retriesPerformedSoFar + 1)
        }
        this._event_queue.push(requestData)
    }

    poll() {
        clearTimeout(this._poller)
        this._poller = setTimeout(() => {
            if (this._event_queue.length > 0) {
                // Clone and flush before doing the requests as they may push to the queue
                const currentEventQueue = this._event_queue.slice(0, this._event_queue.length) // clone queue
                this._event_queue.length = 0 // flush queue
                for (let i = 0; i < currentEventQueue.length; ++i) {
                    const { url, data, options, headers, callback, requestId } = currentEventQueue[i]

                    xhr({
                        url,
                        data,
                        options,
                        requestId,
                        headers,
                        callback,
                        captureMetrics: this.captureMetrics,
                        retryQueue: this,
                    })
                }
                this._empty_queue_count = 0
            } else {
                this._empty_queue_count++
            }

            if (this._empty_queue_count > 4) {
                this.isPolling = false
                this._empty_queue_count = 0
            }
            if (this.isPolling) {
                this.poll()
            }
        }, this._pollInterval)
    }

    unload() {
        clearTimeout(this._poller)
        for (let i = 0; i < this._event_queue.length; ++i) {
            let { url, data, options } = this._event_queue[i]
            window.navigator.sendBeacon(url, encodePostData(data, { ...options, sendBeacon: true }))
        }

        this._event_queue.length = 0
    }
}
