export type LaneDropReason = 'overflow' | 'expired' | 'oversized'

export type QueueEntry<E> = [
    id: number,
    event: E,
    bytes: number,
    admittedAt: number,
    lastAttemptEpoch: number,
    retryAfter: number,
]

type BufferChange = 'enqueue' | 'discard' | 'drop' | 'purge' | 'cleared'

/** Bounded event storage, available before its delivery driver is loaded. */
export class EventBuffer<E> {
    readonly _queue: QueueEntry<E>[] = []
    _activeEntries: QueueEntry<E>[] | undefined
    _disposed = false
    _generation = 0
    _nextId = 0
    _queuedBytes = 0
    _activeBytes = 0
    onChange: ((change: BufferChange) => void) | undefined
    private _dropped = 0
    private _lastNow = 0

    constructor(
        readonly _capacity: number,
        readonly _onDrop: (total: number, count?: number, reason?: LaneDropReason) => void,
        readonly _maxBytes = Number.MAX_SAFE_INTEGER,
        readonly _maxAgeMs = Number.MAX_SAFE_INTEGER,
        private readonly _clock: () => number = Date.now
    ) {}

    enqueue(event: E, bytes = 0): boolean {
        if (this._disposed) {
            return false
        }
        const now = this._now()
        this._expireQueue(now)
        const eventBytes = Number.isFinite(bytes) ? Math.max(0, Math.floor(bytes)) : this._maxBytes + 1
        if (eventBytes > this._maxBytes) {
            this._reportDrop(1, 'oversized')
            return false
        }
        if (this._activeBytes + eventBytes > this._maxBytes) {
            this._reportDrop(1, 'overflow')
            return false
        }

        const generation = this._generation
        let remove = 0
        let queuedBytes = this._queuedBytes
        while (
            remove < this._queue.length &&
            (this._queue.length - remove >= this._capacity ||
                this._activeBytes + queuedBytes + eventBytes > this._maxBytes)
        ) {
            queuedBytes -= this._queue[remove]![2]
            remove++
        }
        if (remove > 0) {
            const dropped = this._queue.splice(0, remove)
            this._queuedBytes = queuedBytes
            this._drop(dropped, 'overflow')
        }
        if (
            generation !== this._generation ||
            this._queue.length >= this._capacity ||
            this._activeBytes + this._queuedBytes + eventBytes > this._maxBytes
        ) {
            this._reportDrop(1, 'overflow')
            return false
        }

        this._queue.push([++this._nextId, event, eventBytes, now, 0, 0])
        this._queuedBytes += eventBytes
        this.onChange?.('enqueue')
        return true
    }

    discardQueued(event: E): boolean {
        for (let index = this._queue.length - 1; index >= 0; index--) {
            const entry = this._queue[index]!
            if (entry[1] === event) {
                this._queue.splice(index, 1)
                this._queuedBytes -= entry[2]
                this.onChange?.('discard')
                return true
            }
        }
        return false
    }

    hasPending(): boolean {
        if (this._disposed) {
            return false
        }
        this._expireQueue(this._now())
        return this._activeEntries !== undefined || this._queue.length > 0
    }

    purge(): void {
        this._generation++
        this.onChange?.('purge')
        this._activeEntries = undefined
        this._activeBytes = 0
        this._queue.length = 0
        this._queuedBytes = 0
        this.onChange?.('cleared')
    }

    dispose(): void {
        this._disposed = true
        this.purge()
    }

    _now(): number {
        try {
            const now = this._clock()
            if (Number.isFinite(now)) {
                this._lastNow = Math.max(this._lastNow, now)
            }
        } catch {
            // The last valid monotonic time remains authoritative.
        }
        return this._lastNow
    }

    _isExpired(entry: QueueEntry<E>, now: number): boolean {
        return now - entry[3] > this._maxAgeMs
    }

    _expireQueue(now: number): void {
        let count = 0
        while (count < this._queue.length && this._isExpired(this._queue[count]!, now)) {
            count++
        }
        if (count > 0) {
            this._drop(this._takeQueue(count), 'expired')
        }
    }

    _takeQueue(count: number): QueueEntry<E>[] {
        const entries = this._queue.splice(0, count)
        for (const entry of entries) {
            this._queuedBytes -= entry[2]
        }
        return entries
    }

    _drop(entries: QueueEntry<E>[], reason: LaneDropReason): void {
        if (entries.length === 0) {
            return
        }
        this._reportDrop(entries.length, reason)
        this.onChange?.('drop')
    }

    _reportDrop(count: number, reason: LaneDropReason): void {
        this._dropped += count
        try {
            this._onDrop(this._dropped, count, reason)
        } catch {
            // Reporting must not affect admission.
        }
    }
}
