import { QueuedRequestWithOptions, RequestQueueConfig } from './types'
import { each, eachArray } from '@posthog/browser-common/utils/general-utils'

import { isUndefined, clampToRange } from '@posthog/core'
import { logger } from '@posthog/browser-common/utils/logger'

export const DEFAULT_FLUSH_INTERVAL_MS = 3000

export class RequestQueue {
    // We start in a paused state and only start flushing when enabled by the parent
    private _isPaused: boolean = true
    private _queue: QueuedRequestWithOptions[] = []
    private _flushTimeout?: ReturnType<typeof setTimeout>
    private _flushTimeoutMs: number
    private _sendRequest: (
        req: QueuedRequestWithOptions,
        transportOverride?: QueuedRequestWithOptions['transport']
    ) => void

    constructor(
        sendRequest: (req: QueuedRequestWithOptions, transportOverride?: QueuedRequestWithOptions['transport']) => void,
        config?: RequestQueueConfig
    ) {
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
            // Each fallback part of a split beacon reports to this callback, so a 2xx for one part could confirm
            // an identifier that only a failed part carried. Without it, the identifier stays pending and goes
            // out again with a later event.
            this._sendRequestSafely({ ...req, callback: undefined }, 'sendBeacon')
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
            this._flush()
        }, this._flushTimeoutMs)
    }

    private _flush(): void {
        if (this._queue.length > 0) {
            const requests = this._formatQueue()
            for (const key in requests) {
                this._sendRequestSafely(requests[key])
            }
        }
    }

    private _sendRequestSafely(
        req: QueuedRequestWithOptions,
        transportOverride?: QueuedRequestWithOptions['transport']
    ): void {
        try {
            this._sendRequest(req, transportOverride)
        } catch (error) {
            logger.error(error)
        }
    }

    private _clearFlushTimeout(): void {
        clearTimeout(this._flushTimeout)
        this._flushTimeout = undefined
    }

    private _formatQueue(): Record<string, QueuedRequestWithOptions> {
        const requests: Record<string, QueuedRequestWithOptions> = {}
        const callbacks: Record<string, NonNullable<QueuedRequestWithOptions['callback']>[]> = {}
        each(this._queue, (request: QueuedRequestWithOptions) => {
            const req = request
            const key = ((req ? req.batchKey : null) || req.url) + (req.batchGroup ? `:${req.batchGroup}` : '')
            if (isUndefined(requests[key])) {
                // TODO: What about this -it seems to batch data into an array - do we always want that?
                // callback and fireCallbackOnDrop belong to each request, not to the first one. fireCallbackOnDrop
                // stays off, because the batch callback also reaches requests that did not ask for drop notifications.
                requests[key] = { ...req, data: [], callback: undefined, fireCallbackOnDrop: undefined }
            }

            requests[key].data?.push(req.data)
            if (req.callback) {
                if (!callbacks[key]) {
                    callbacks[key] = []
                }
                callbacks[key].push(req.callback)
            }
        })

        for (const key in callbacks) {
            // Every batched request needs its own delivery outcome, e.g. to confirm a pending Meta identifier
            const batchCallbacks = callbacks[key]
            requests[key].callback = (response) => eachArray(batchCallbacks, (callback) => callback(response))
        }

        this._queue = []
        return requests
    }
}
