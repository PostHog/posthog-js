export class RequestQueueScaffold {
    constructor(pollInterval = 3000) {
        this.isPolling = true // flag to continue to recursively poll or not
        this._event_queue = []
        this._empty_queue_count = 0 // to track empty polls
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

    enqueue() {
        return
    }

    poll() {
        return
    }

    unload() {
        return
    }

    getTime() {
        return new Date().getTime()
    }
}
