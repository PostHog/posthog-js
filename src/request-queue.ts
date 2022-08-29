import { RequestQueueScaffold } from './base-request-queue'
import { _each } from './utils'
import { CaptureMetrics } from './capture-metrics'
import { Properties, QueuedRequestData, XHROptions } from './types'

export class RequestQueue extends RequestQueueScaffold {
    captureMetrics: CaptureMetrics
    handlePollRequest: (url: string, data: Properties, options?: XHROptions) => void

    constructor(
        captureMetrics: CaptureMetrics,
        handlePollRequest: (url: string, data: Properties, options?: XHROptions) => void,
        pollInterval = 3000
    ) {
        super(pollInterval)
        this.handlePollRequest = handlePollRequest
        this.captureMetrics = captureMetrics
    }

    enqueue(url: string, data: Properties, options: XHROptions): void {
        this.captureMetrics.incr('batch-enqueue')

        this._event_queue.push({ url, data, options })

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
                    const { url, data, options } = requests[key]
                    _each(data, (_, dataKey) => {
                        data[dataKey]['offset'] = Math.abs(data[dataKey]['timestamp'] - this.getTime())
                        delete data[dataKey]['timestamp']
                    })
                    this.handlePollRequest(url, data, options)

                    this.captureMetrics.incr('batch-requests')
                    this.captureMetrics.incr(`batch-requests-${url.slice(url.length - 2)}`)
                    this.captureMetrics.incr('batch-handle', data.length)
                    this.captureMetrics.incr(`batch-handle-${url.slice(url.length - 2)}`, data.length)
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

    updateUnloadMetrics(): void {
        const requests = this.formatQueue()
        for (const key in requests) {
            const { url, data } = requests[key]

            this.captureMetrics.incr('batch-unload-requests')
            this.captureMetrics.incr(`batch-unload-requests-${url.slice(url.length - 2)}`)
            this.captureMetrics.incr('batch-unload', data.length)
            this.captureMetrics.incr(`batch-unload-${url.slice(url.length - 2)}`, data.length)
        }
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
        sortedRequests.map(({ url, data, options }) => {
            this.handlePollRequest(url, data, { ...options, transport: 'sendBeacon' })
        })
    }

    formatQueue(): Record<string, QueuedRequestData> {
        const requests: Record<string, QueuedRequestData> = {}
        _each(this._event_queue, (request) => {
            const { url, data, options } = request
            const key = (options ? options._batchKey : null) || url
            if (requests[key] === undefined) {
                requests[key] = { data: [], url, options }
            }

            // :TRICKY: Metrics-only code
            if (
                options &&
                requests[key].options &&
                requests[key].options._metrics &&
                !(requests[key].options._metrics as any)['rrweb_full_snapshot']
            ) {
                ;(requests[key].options._metrics as any)['rrweb_full_snapshot'] =
                    options._metrics['rrweb_full_snapshot']
            }
            requests[key].data.push(data)
        })
        return requests
    }
}
