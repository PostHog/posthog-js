import { RequestQueueScaffold } from './base-request-queue'
import { QueuedRequestOptions } from './types'
import { _each } from './utils'

import { _isUndefined } from './utils/type-utils'

export class RequestQueue extends RequestQueueScaffold {
    handlePollRequest: (req: QueuedRequestOptions) => void

    constructor(handlePollRequest: (req: QueuedRequestOptions) => void, pollInterval = 3000) {
        super(pollInterval)
        this.handlePollRequest = handlePollRequest
    }

    enqueue(req: QueuedRequestOptions): void {
        this._event_queue.push(req)

        if (!this.isPolling) {
            this.isPolling = true
            this.poll()
        }
    }

    poll(): void {
        clearTimeout(this._poller)
        this._poller = setTimeout(() => {
            if (this._event_queue.length > 0) {
                const requests = this.formatQueue()
                for (const key in requests) {
                    const req = requests[key]
                    // if (req.data) {
                    //     _each(req.data, (_, dataKey) => {
                    //         // TODO: WWhat is this doing?
                    //         // req.data[dataKey]['offset'] = Math.abs(req.data[dataKey]['timestamp'] - this.getTime())
                    //         // delete req.data[dataKey]['timestamp']
                    //     })
                    // }
                    this.handlePollRequest(req)
                }
                this._event_queue.length = 0 // flush the _event_queue
                this._empty_queue_count = 0
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
        }, this._pollInterval) as any as number
    }

    unload(): void {
        clearTimeout(this._poller)
        const requests = this._event_queue.length > 0 ? this.formatQueue() : {}
        this._event_queue.length = 0
        const requestValues = Object.values(requests)

        // Always force events to be sent before recordings, as events are more important, and recordings are bigger and thus less likely to arrive
        const sortedRequests = [
            ...requestValues.filter((r) => r.url.indexOf('/e') === 0),
            ...requestValues.filter((r) => r.url.indexOf('/e') !== 0),
        ]
        sortedRequests.map((req) => {
            this.handlePollRequest({ ...req, transport: 'sendBeacon' })
        })
    }

    formatQueue(): Record<string, QueuedRequestOptions> {
        const requests: Record<string, QueuedRequestOptions> = {}
        _each(this._event_queue, (request: QueuedRequestOptions) => {
            const req = request
            const key = (req ? req.batchKey : null) || req.url
            if (_isUndefined(requests[key])) {
                // TODO: What about this -it seems to batch data into an array - do we always want that?
                requests[key] = { ...req, data: [] }
            }

            requests[key].data?.push(req.data)
        })
        return requests
    }
}
