import { _ } from './utils'

const POLL_INTERVAL = 3000

export class EventQueue {
    constructor(handlePollRequest) {
        this.handlePollRequest = handlePollRequest
        this._event_queue = []
        this._empty_queue_count = 0 // to track empty polls
        this._should_poll = true // flag to continue to recursively poll or not
        this._poller = function () {} // to become interval for reference to clear later
    }

    enqueue(url, data) {
        this._event_queue.push({ url, data })

        if (!this._should_poll) {
            this._should_poll = true
            this.poll()
        }
    }

    poll() {
        clearInterval(this._poller)
        this._poller = setTimeout(() => {
            if (this._event_queue.length > 0) {
                const requests = this._format_event_queue_data()
                for (let url in requests) {
                    let data = requests[url]
                    _.each(data, function (value, key) {
                        data[key]['offset'] = Math.abs(data[key]['timestamp'] - new Date())
                        delete data[key]['timestamp']
                    })
                    this.handlePollRequest(data)
                }
                this._event_queue.length = 0 // flush the _event_queue
            } else {
                this._empty_queue_count++
            }

            /**
             * _empty_queue_count will increment each time the queue is polled
             *  and it is empty. To avoid empty polling (user went idle, stepped away from comp)
             *  we can turn it off with the _should_poll flag.
             *
             * Polling will be re enabled when the next time PostHogLib.capture is called with
             *  an event that should be added to the event queue.
             */
            if (this._empty_queue_count > 4) {
                this._should_poll = false
                this._empty_queue_count = 0
            }
            if (this._should_poll) {
                this.poll()
            }
        }, POLL_INTERVAL)
    }

    unload() {
        clearInterval(this._poller)
        let requests = {}
        if (this._event_queue.length > 0) {
            requests = this._format_event_queue_data()
        }
        this._event_queue.length = 0
        for (let url in requests) {
            this.handleRequest(requests[url], { unload: true })
        }
    }

    _format_event_queue_data() {
        const requests = {}
        _.each(this._event_queue, (request) => {
            const { url, data } = request
            if (requests[url] === undefined) requests[url] = []
            requests[url].push(data)
        })
        return requests
    }
}
