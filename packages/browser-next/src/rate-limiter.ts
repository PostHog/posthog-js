export interface ClientRateLimitResult {
    allowed: boolean
    reportDropped?: number
}

/** Compact in-memory token bucket that prevents runaway capture loops. */
export class ClientRateLimiter {
    private _tokens: number
    private _last = 0
    private _initialized = false
    private _limited = false
    private _unreportedDropped = 0

    constructor(
        private readonly _eventsPerSecond = 10,
        private readonly _burst = 100,
        private readonly _clock: () => number = Date.now
    ) {
        this._tokens = Math.max(1, _burst)
    }

    consume(): ClientRateLimitResult {
        const now = this._now()
        if (!this._initialized) {
            this._initialized = true
            this._last = now
        } else {
            const elapsed = Math.max(0, now - this._last)
            this._last = Math.max(this._last, now)
            this._tokens = Math.min(this._burst, this._tokens + (elapsed / 1_000) * this._eventsPerSecond)
        }

        if (this._tokens >= 1) {
            this._tokens = Math.max(0, this._tokens - 1)
            this._limited = false
            return { allowed: true }
        }

        this._unreportedDropped++
        const reportDropped = this._limited ? undefined : this._unreportedDropped
        this._limited = true
        return { allowed: false, ...(reportDropped === undefined ? {} : { reportDropped }) }
    }

    reported(): void {
        this._unreportedDropped = 0
    }

    private _now(): number {
        try {
            const value = this._clock()
            return Number.isFinite(value) ? Math.max(0, value) : this._last
        } catch {
            return this._last
        }
    }
}
