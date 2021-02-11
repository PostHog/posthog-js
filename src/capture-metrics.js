import { _ } from './utils'

export class CaptureMetrics {
    constructor(enabled, capture, getTime = () => new Date().getTime()) {
        this.enabled = enabled
        this.capture = capture
        this.getTime = getTime
        this.metrics = {}
        this.requests = {}
    }

    incr(key, by = 1) {
        if (this.enabled) {
            key = `phjs-${key}`
            this.metrics[key] = (this.metrics[key] || 0) + by
        }
    }

    decr(key) {
        if (this.enabled) {
            key = `phjs-${key}`
            this.metrics[key] = (this.metrics[key] || 0) - 1
        }
    }

    startRequest(payload) {
        if (this.enabled) {
            const requestId = _.UUID()

            this.requests[requestId] = [this.getTime(), payload]

            return requestId
        }
    }

    finishRequest(requestId) {
        if (this.enabled && this.requests[requestId]) {
            const [startTime, payload] = this.requests[requestId]
            payload['duration'] = this.getTime() - startTime
            delete this.requests[requestId]
            return payload
        }
    }

    markRequestFailed(payload) {
        if (this.enabled) {
            this.capture('$capture_failed_request', payload)
        }
    }

    captureInProgressRequests() {
        if (this.enabled) {
            Object.keys(this.requests).forEach((requestId) => {
                const payload = this.finishRequest(requestId)
                this.markRequestFailed({ ...payload, type: 'inflight_at_unload' })
            })
        }
    }
}
