import { RequestQueueScaffold } from './base-request-queue'
import { encodePostData, xhr } from './send-request'

export class RetryQueue extends RequestQueueScaffold {
    constructor(captureMetrics) {
        super()
        this.captureMetrics = captureMetrics
        this._requestRetriesMap = {} // <RequestId, number>
        this._counterToQueueMap = {}
        this._pollerCounter = 1
        this._currentQueueLength = 0
        this._areWeOnline = 'onLine' in window.navigator ? window.navigator.onLine : true
        this._offlineBacklog = []

        if ('onLine' in window.navigator) {
            window.addEventListener('online', () => {
                this._areWeOnline = true
                this._flushOfflineBacklog()
            })
            window.addEventListener('offline', () => {
                this._areWeOnline = false
            })
        }
    }

    enqueue(requestData) {
        const { requestId } = requestData
        let retriesPerformedSoFar = 0
        if (!(requestId in this._requestRetriesMap)) {
            this._requestRetriesMap[requestId] = 0
        } else {
            retriesPerformedSoFar = this._requestRetriesMap[requestId]
            if (retriesPerformedSoFar === 10) {
                delete this._requestRetriesMap[requestId]
                return
            }
            this._requestRetriesMap[requestId]++
        }

        const nextRetry = this._pollerCounter + 2 ** retriesPerformedSoFar
        if (!(nextRetry in this._counterToQueueMap)) {
            this._counterToQueueMap[nextRetry] = []
        }
        this._counterToQueueMap[nextRetry].push(requestData)
        this.poll()
    }

    poll() {
        clearTimeout(this._poller)
        this._poller = setTimeout(() => {
            const currentQueue = this._counterToQueueMap[this._pollerCounter]
            if (currentQueue && currentQueue.length > 0) {
                if (!this._areWeOnline) {
                    this._offlineBacklog = [...this._offlineBacklog, ...currentQueue]
                } else {
                    for (let i = 0; i < currentQueue.length; ++i) {
                        const { url, data, options, headers, callback, requestId } = currentQueue[i]
                        xhr({
                            url,
                            data: data || {},
                            options: options || {},
                            headers: headers || {},
                            requestId,
                            callback,
                            captureMetrics: this.captureMetrics,
                            retryQueue: this,
                        })
                    }
                }

                delete this._counterToQueueMap[this._pollerCounter]
            }
            this.poll()
            this._pollerCounter++
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

    _flushOfflineBacklog() {
        for (let i = 0; i < this._offlineBacklog.length; ++i) {
            const { url, data, options, headers, callback, requestId } = this._offlineBacklog[i]
            xhr({
                url,
                data: data || {},
                options: options || {},
                headers: headers || {},
                requestId,
                callback,
                captureMetrics: this.captureMetrics,
                retryQueue: this,
            })
        }
        this._offlineBacklog.length = 0
    }
}
