import { _ } from './utils'

export class RequestQueue {
    constructor(handlePollRequest, pollInterval = 3000) {
        this.handlePollRequest = handlePollRequest
        this.isPolling = true // flag to continue to recursively poll or not
        this._event_queue = []
        this._empty_queue_count = 0 // to track empty polls
        this.pollInterval = pollInterval
        this._poller = function () {} // to become interval for reference to clear later
        this._pollInterval = pollInterval
    }

    setPollInterval(interval) {
        this._pollInterval = interval
        // Reset interval if running already
        if (this.isPolling) {
            this.poll()
        }
    }

    enqueue(url, data) {
        this._event_queue.push({ url, data })

        if (!this.isPolling) {
            this.isPolling = true
            this.poll()
        }
    }

    poll() {
        clearTimeout(this._poller)
        this._poller = setTimeout(() => {
            if (this._event_queue.length > 0) {
                const requests = this.formatQueue()
                for (let url in requests) {
                    let data = requests[url]
                    _.each(data, (_, key) => {
                        data[key]['offset'] = Math.abs(data[key]['timestamp'] - this.getTime())
                        delete data[key]['timestamp']
                    })
                    this.handlePollRequest(url, data)
                }
                this._event_queue.length = 0 // flush the _event_queue
            } else {
                this._empty_queue_count++
            }

            /**
             * _empty_queue_count will increment each time the queue is polled
             *  and it is empty. To avoid empty polling (user went idle, stepped away from comp)
             *  we can turn it off with the isPolling flag.
             *
             * Polling will be re enabled when the next time PostHogLib.capture is called with
             *  an event that should be added to the event queue.
             */
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
        const requests = this._event_queue.length > 0 ? this.formatQueue() : {}
        this._event_queue.length = 0
        for (let url in requests) {
            this.handlePollRequest(url, requests[url], { unload: true })
        }
    }

    formatQueue() {
        const requests = {}
        _.each(this._event_queue, (request) => {
            const { url, data } = request
            if (requests[url] === undefined) requests[url] = []
            requests[url].push(data)
        })
        return requests
    }

    getTime() {
        return new Date().getTime()
    }
}
