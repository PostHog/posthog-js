import { _ } from './utils'

export class CaptureMetrics {
    constructor(enabled) {
        this.enabled = enabled
        this.metrics = {}
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
}
