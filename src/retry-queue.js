import { RequestQueueScaffold } from './base-request-queue'
import { encodePostData, xhr } from './send-request'

export class RetryQueue extends RequestQueueScaffold {
    constructor(captureMetrics) {
        super()
        this.captureMetrics = captureMetrics
        this.isPolling = false
        this._requestRetriesMap = {} // <RequestId, number>
        this._counterToQueueMap = {}
        this._pollerCounter = 1
        this._areWeOnline = 'onLine' in window.navigator ? window.navigator.onLine : true
        this._offlineBacklog = []

        if ('onLine' in window.navigator) {
            window.addEventListener('online', () => {
                this._handleWeAreNowOnline()
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

        const nextRetry = this._pollerCounter - 1 + 2 ** retriesPerformedSoFar
        if (!(nextRetry in this._counterToQueueMap)) {
            this._counterToQueueMap[nextRetry] = []
        }
        this._counterToQueueMap[nextRetry].push(requestData)
        if (!this.isPolling) {
            this.isPolling = true
            this.poll()
        }
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
                        this._executeXhrRequest(currentQueue[i])
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
        const existingQueues = Object.values(this._counterToQueueMap)
        for (let i = 0; i < existingQueues.length; ++i) {
            const currentQueue = existingQueues[i]
            for (let j = 0; j < currentQueue.length; ++j) {
                const { url, data, options } = currentQueue[j]
                window.navigator.sendBeacon(url, encodePostData(data, { ...options, sendBeacon: true }))
            }
        }

        this._event_queue.length = 0
    }

    _flushOfflineBacklog() {
        for (let i = 0; i < this._offlineBacklog.length; ++i) {
            this._executeXhrRequest(this._offlineBacklog[i])
        }
        this._offlineBacklog.length = 0
    }

    _executeXhrRequest({ url, data, options, headers, callback, requestId }) {
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

    _handleWeAreNowOnline() {
        this._areWeOnline = true
        this._flushOfflineBacklog()
    }
}
