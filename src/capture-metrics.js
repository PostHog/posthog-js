export class CaptureMetrics {
    constructor(capture) {
        this.capture = capture
        this.metrics = {}
    }

    incr(key, by = 1) {
        if (this.capture) {
            key = `phjs-${key}`
            this.metrics[key] = (this.metrics[key] || 0) + by
        }
    }

    decr(key) {
        if (this.capture) {
            key = `phjs-${key}`
            this.metrics[key] = (this.metrics[key] || 0) - 1
        }
    }
}
