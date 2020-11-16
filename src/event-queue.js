import { _ } from './utils'

const POLL_INTERVAL = 3000
// :TODO: Reference comparisons here might fail!
const __NOOP = function () {}
const __NOOPTIONS = {}

export class EventQueue {
    constructor(instance) {
        this.instance = instance
        this._event_queue = []
        this._empty_queue_count = 0 // to track empty polls
        this._should_poll = true // flag to continue to recursively poll or not
        this._poller = function () {} // to become interval for reference to clear later
    }

    enqueue(url, data, options, callback) {
        this._event_queue.push({ url, data, options, callback })

        if (!this._should_poll) {
            this._should_poll = true
            this._event_queue_poll()
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
                    var json_data = _.JSONEncode(data)
                    if (this.instance.compression['lz64']) {
                        var encoded_data = LZString.compressToBase64(json_data)
                        this.instance._send_request(
                            url,
                            { data: encoded_data, compression: 'lz64' },
                            __NOOPTIONS,
                            __NOOP
                        )
                    } else {
                        var encoded_data = _.base64Encode(json_data)
                        this.instance._send_request(url, { data: encoded_data }, __NOOPTIONS, __NOOP)
                    }
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
        let data = {}
        if (this._event_queue.length > 0) {
            data = this._format_event_queue_data()
        }
        this._event_queue.length = 0
        for (let url in data) {
            // sendbeacon has some hard requirments and cant be treated
            // like a normal post request. Because of that it needs to be encoded
            if (this.instance.compression['lz64']) {
                const encoded_data = LZString.compressToBase64(_.JSONEncode(data[url]))
                this.instance._send_request(
                    url,
                    { data: encoded_data, compression: 'lz64' },
                    { transport: 'sendbeacon' },
                    __NOOP
                )
            } else {
                const encoded_data = _.base64Encode(_.JSONEncode(data[url]))
                this.instance._send_request(url, { data: encoded_data }, { transport: 'sendbeacon' }, __NOOP)
            }
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
