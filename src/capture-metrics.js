export class CaptureMetrics {
    constructor(capture) {
        this.capture = capture
        this.metrics = {}
    }

    incr(key, by = 1) {
        key = `$phjs-${key}`
        if (this.capture) {
            this.metrics[key] = (this.metrics[key] || 0) + by
        }
    }
}
