import { QueuedRequestWithOptions, RequestQueueConfig } from './types'
import { each } from './utils'

import { isArray, isUndefined, clampToRange } from '@posthog/core'
import { logger } from './utils/logger'

export const DEFAULT_FLUSH_INTERVAL_MS = 3000

export class RequestQueue {
    // We start in a paused state and only start flushing when enabled by the parent
    private _isPaused: boolean = true
    private _queue: QueuedRequestWithOptions[] = []
    private _flushTimeout?: ReturnType<typeof setTimeout>
    private _flushTimeoutMs: number
    private _sendRequest: (req: QueuedRequestWithOptions) => void

    constructor(sendRequest: (req: QueuedRequestWithOptions) => void, config?: RequestQueueConfig) {
        this._flushTimeoutMs = clampToRange(
            config?.flush_interval_ms || DEFAULT_FLUSH_INTERVAL_MS,
            250,
            5000,
            logger.createLogger('flush interval'),
            DEFAULT_FLUSH_INTERVAL_MS
        )
        this._sendRequest = sendRequest
    }

    enqueue(req: QueuedRequestWithOptions): void {
        this._queue.push(req)

        if (!this._flushTimeout) {
            this._setFlushTimeout()
        }
    }

    unload(): void {
        this._clearFlushTimeout()
        const requests = this._queue.length > 0 ? this._formatQueue() : {}
        const requestValues = Object.values(requests)

        // Always force events to be sent before recordings, as events are more important, and recordings are bigger and thus less likely to arrive
        const sortedRequests = [
            ...requestValues.filter((r) => r.url.indexOf('/e') === 0),
            ...requestValues.filter((r) => r.url.indexOf('/e') !== 0),
        ]
        sortedRequests.map((req) => {
            this._sendRequest({ ...req, transport: 'sendBeacon' })
        })
    }

    enable(): void {
        this._isPaused = false
        this._setFlushTimeout()
    }

    private _setFlushTimeout(): void {
        if (this._isPaused) {
            return
        }
        this._flushTimeout = setTimeout(() => {
            this._clearFlushTimeout()
            if (this._queue.length > 0) {
                const requests = this._formatQueue()
                for (const key in requests) {
                    const req = requests[key]
                    const now = new Date().getTime()

                    if (req.data && isArray(req.data)) {
                        each(req.data, (data) => {
                            data['offset'] = Math.abs(data['timestamp'] - now)
                            delete data['timestamp']
                        })
                    }
                    this._sendRequest(req)
                }
            }
        }, this._flushTimeoutMs)
    }

    private _clearFlushTimeout(): void {
        clearTimeout(this._flushTimeout)
        this._flushTimeout = undefined
    }

    private _formatQueue(): Record<string, QueuedRequestWithOptions> {
        const requests: Record<string, QueuedRequestWithOptions> = {}
        each(this._queue, (request: QueuedRequestWithOptions) => {
            const req = request
            const key = (req ? req.batchKey : null) || req.url
            if (isUndefined(requests[key])) {
                // TODO: What about this -it seems to batch data into an array - do we always want that?
                requests[key] = { ...req, data: [] }
            }

            requests[key].data?.push(req.data)
        })

        this._queue = []
        return requests
    }
}
