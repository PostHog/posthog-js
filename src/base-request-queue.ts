export class RequestQueueScaffold {
    isPolling: boolean // flag to continue to recursively poll or not
    _event_queue: any[]
    _empty_queue_count: number // to track empty polls
    _poller: number | undefined // to become interval for reference to clear later
    _pollInterval: number

    constructor(pollInterval = 3000) {
        this.isPolling = true // flag to continue to recursively poll or not
        this._event_queue = []
        this._empty_queue_count = 0 // to track empty polls
        this._poller = undefined // to become interval for reference to clear later
        this._pollInterval = pollInterval
    }

    setPollInterval(interval: number): void {
        this._pollInterval = interval
        // Reset interval if running already
        if (this.isPolling) {
            this.poll()
        }
    }

    // // eslint-disable-next-line no-unused-vars
    // enqueue(_requestData: Record<string, any>): void {
    //     return
    // }

    poll(): void {
        return
    }

    unload(): void {
        return
    }

    getTime(): number {
        return new Date().getTime()
    }
}
