export class CaptureMetrics {
    enabled: boolean
    metrics: Record<string, number>

    constructor(enabled: boolean) {
        this.enabled = enabled
        this.metrics = {}
    }

    incr(key: string, by = 1): void {
        if (this.enabled) {
            key = `phjs-${key}`
            this.metrics[key] = (this.metrics[key] || 0) + by
        }
    }

    decr(key: string): void {
        if (this.enabled) {
            key = `phjs-${key}`
            this.metrics[key] = (this.metrics[key] || 0) - 1
        }
    }
}
