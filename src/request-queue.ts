import { QueuedRequestWithOptions, RequestQueueConfig } from './types'
import { each } from './utils'

import { isArray, isUndefined } from './utils/type-utils'
import { clampToRange } from './utils/number-utils'

export const DEFAULT_FLUSH_INTERVAL_MS = 3000

export class RequestQueue {
    // We start in a paused state and only start flushing when enabled by the parent
    private isPaused: boolean = true
    private queue: QueuedRequestWithOptions[] = []
    private flushTimeout?: ReturnType<typeof setTimeout>
    private flushTimeoutMs: number
    private sendRequest: (req: QueuedRequestWithOptions) => void

    constructor(sendRequest: (req: QueuedRequestWithOptions) => void, config?: RequestQueueConfig) {
        this.flushTimeoutMs = clampToRange(
            config?.flush_interval_ms || DEFAULT_FLUSH_INTERVAL_MS,
            250,
            5000,
            'flush interval',
            DEFAULT_FLUSH_INTERVAL_MS
        )
        this.sendRequest = sendRequest
    }

    enqueue(req: QueuedRequestWithOptions): void {
        this.queue.push(req)

        if (!this.flushTimeout) {
            this.setFlushTimeout()
        }
    }

    unload(): void {
        this.clearFlushTimeout()
        const requests = this.queue.length > 0 ? this.formatQueue() : {}
        const requestValues = Object.values(requests)

        // Always force events to be sent before recordings, as events are more important, and recordings are bigger and thus less likely to arrive
        const sortedRequests = [
            ...requestValues.filter((r) => r.url.indexOf('/e') === 0),
            ...requestValues.filter((r) => r.url.indexOf('/e') !== 0),
        ]
        sortedRequests.map((req) => {
            this.sendRequest({ ...req, transport: 'sendBeacon' })
        })
    }

    enable(): void {
        this.isPaused = false
        this.setFlushTimeout()
    }

    private setFlushTimeout(): void {
        if (this.isPaused) {
            return
        }
        this.flushTimeout = setTimeout(() => {
            this.clearFlushTimeout()
            if (this.queue.length > 0) {
                const requests = this.formatQueue()
                for (const key in requests) {
                    const req = requests[key]
                    const now = new Date().getTime()

                    if (req.data && isArray(req.data)) {
                        each(req.data, (data) => {
                            data['offset'] = Math.abs(data['timestamp'] - now)
                            delete data['timestamp']
                        })
                    }
                    this.sendRequest(req)
                }
            }
        }, this.flushTimeoutMs)
    }

    private clearFlushTimeout(): void {
        clearTimeout(this.flushTimeout)
        this.flushTimeout = undefined
    }

    private formatQueue(): Record<string, QueuedRequestWithOptions> {
        const requests: Record<string, QueuedRequestWithOptions> = {}
        each(this.queue, (request: QueuedRequestWithOptions) => {
            const req = request
            const key = (req ? req.batchKey : null) || req.url
            if (isUndefined(requests[key])) {
                // TODO: What about this -it seems to batch data into an array - do we always want that?
                requests[key] = { ...req, data: [] }
            }

            requests[key].data?.push(req.data)
        })

        this.queue = []
        return requests
    }
}
