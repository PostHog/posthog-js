import type { Disposable } from '@posthog/browser-common'

export interface LaneDeliveryContext {
    readonly signal: AbortSignal | undefined
    canContinue(): boolean
}

export interface LaneDeliveryResult<E> {
    readonly retry: readonly E[]
}

export interface LaneDelivery<E> {
    readonly batchSize?: number
    deliver(events: readonly E[], context: LaneDeliveryContext): Promise<LaneDeliveryResult<E> | void>
}

type LaneDropReason = 'overflow' | 'expired' | 'oversized'

type QueueEntry<E> = [id: number, event: E, bytes: number, admittedAt: number]
type AttachedDelivery<E> = [delivery: LaneDelivery<E>, token: object]
type FlushWaiter = [target: number, resolve: () => void]

/** Package-private bounded admission queue with one replaceable delivery policy. */
export class Lane<E> {
    private readonly _queue: QueueEntry<E>[] = []
    private readonly _flushWaiters: FlushWaiter[] = []
    private _delivery: AttachedDelivery<E> | undefined
    private _drainingDelivery: AttachedDelivery<E> | undefined
    private _activeEntries: QueueEntry<E>[] | undefined
    private _drain: Promise<void> | undefined
    private _abort: AbortController | undefined
    private _requeueActive = false
    private _disposed = false
    private _dropped = 0
    private _nextId = 0
    private _settledId = 0
    private _generation = 0
    private _queuedBytes = 0
    private _activeBytes = 0
    private _lastNow = 0

    constructor(
        private readonly _capacity: number,
        private readonly _onError: (error: unknown) => void,
        private readonly _onDrop: (total: number, count?: number, reason?: LaneDropReason) => void,
        private readonly _maxBytes = Number.MAX_SAFE_INTEGER,
        private readonly _maxAgeMs = Number.MAX_SAFE_INTEGER,
        private readonly _clock: () => number = Date.now,
        private readonly _onAvailable: () => void = () => {}
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

        this._queue.push([++this._nextId, event, eventBytes, now])
        this._queuedBytes += eventBytes
        this._startDrain()
        return true
    }

    discardQueued(event: E): boolean {
        for (let index = this._queue.length - 1; index >= 0; index--) {
            const entry = this._queue[index]!
            if (entry[1] === event) {
                this._queue.splice(index, 1)
                this._queuedBytes -= entry[2]
                this._updateSettled()
                return true
            }
        }
        return false
    }

    install(delivery: LaneDelivery<E>): Disposable {
        if (this._disposed) {
            throw new Error('The lane is disposed')
        }
        if (this._delivery) {
            throw new Error('A delivery policy is already installed')
        }
        const token = {}
        this._delivery = [delivery, token]
        this._expireQueue(this._now())
        this._startDrain()
        return {
            dispose: () => {
                if (this._delivery?.[1] === token) {
                    if (this._drainingDelivery === this._delivery) {
                        this._requeueActive = true
                    }
                    this._delivery = undefined
                    this._generation++
                    this._cancelActive()
                }
            },
        }
    }

    purge(): void {
        this._generation++
        this._requeueActive = false
        this._cancelActive()
        this._activeEntries = undefined
        this._activeBytes = 0
        this._queue.splice(0)
        this._queuedBytes = 0
        this._updateSettled()
    }

    flush(): Promise<void> {
        this._expireQueue(this._now())
        if (!this._delivery || this._settledId >= this._nextId) {
            return Promise.resolve()
        }
        const target = this._nextId
        this._startDrain()
        return new Promise((resolve) => this._flushWaiters.push([target, resolve]))
    }

    async dispose(): Promise<void> {
        if (this._disposed) {
            return
        }
        this._disposed = true
        this._delivery = undefined
        this.purge()
        this._resolveFlushWaiters(true)
        await this._drain
    }

    private _now(): number {
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

    private _cancelActive(): void {
        try {
            this._abort?.abort()
        } catch {
            // The generation check remains authoritative when abort throws.
        }
    }

    private _isExpired(entry: QueueEntry<E>, now: number): boolean {
        return now - entry[3] > this._maxAgeMs
    }

    private _expireQueue(now: number): void {
        let count = 0
        while (count < this._queue.length && this._isExpired(this._queue[count]!, now)) {
            count++
        }
        if (count > 0) {
            const entries = this._takeQueue(count)
            this._drop(entries, 'expired')
        }
    }

    private _takeQueue(count: number): QueueEntry<E>[] {
        const entries = this._queue.splice(0, count)
        for (const entry of entries) {
            this._queuedBytes -= entry[2]
        }
        return entries
    }

    private _trimQueue(): void {
        let remove = 0
        let bytes = this._queuedBytes
        while (
            remove < this._queue.length &&
            (this._queue.length - remove > this._capacity || bytes > this._maxBytes)
        ) {
            bytes -= this._queue[remove]![2]
            remove++
        }
        if (remove > 0) {
            const entries = this._queue.splice(0, remove)
            this._queuedBytes = bytes
            this._drop(entries, 'overflow')
        }
    }

    private _drop(entries: QueueEntry<E>[], reason: LaneDropReason): void {
        if (entries.length === 0) {
            return
        }
        this._reportDrop(entries.length, reason)
        this._updateSettled()
    }

    private _reportDrop(count: number, reason: LaneDropReason): void {
        this._dropped += count
        try {
            this._onDrop(this._dropped, count, reason)
        } catch {
            // Reporting must not affect admission.
        }
    }

    private _updateSettled(): void {
        const activeId = this._activeEntries?.[0]?.[0]
        const queuedId = this._queue[0]?.[0]
        const firstPending =
            activeId === undefined ? queuedId : queuedId === undefined ? activeId : Math.min(activeId, queuedId)
        this._settledId = firstPending === undefined ? this._nextId : firstPending - 1
        this._resolveFlushWaiters(false)
    }

    private _reportError(error: unknown): void {
        try {
            this._onError(error)
        } catch {
            // Reporting must not affect delivery lifecycle.
        }
    }

    private _reportAvailable(): void {
        try {
            this._onAvailable()
        } catch (error) {
            this._reportError(error)
        }
    }

    private _resolveFlushWaiters(force: boolean): void {
        for (let index = this._flushWaiters.length - 1; index >= 0; index--) {
            const [target, resolve] = this._flushWaiters[index]!
            if (force || target <= this._settledId) {
                this._flushWaiters.splice(index, 1)
                resolve()
            }
        }
    }

    private _startDrain(): void {
        this._expireQueue(this._now())
        const attached = this._delivery
        if (this._disposed || this._drain || !attached || this._queue.length === 0) {
            return
        }
        const generation = this._generation
        let controller: AbortController | undefined
        try {
            controller = new AbortController()
        } catch {
            // Generation checks still cancel staged work and future attempts.
        }
        this._abort = controller
        this._drainingDelivery = attached
        this._requeueActive = false
        const canContinue = (): boolean =>
            !this._disposed &&
            this._delivery === attached &&
            this._generation === generation &&
            !(controller?.signal.aborted ?? false)

        this._drain = Promise.resolve()
            .then(async () => {
                if (!canContinue()) {
                    return
                }
                let configuredSize: number | undefined
                try {
                    configuredSize = attached[0].batchSize
                } catch (error) {
                    configuredSize = 1
                    this._reportError(error)
                }
                configuredSize ??= this._queue.length
                const batchSize = Math.max(1, Math.floor(Number.isFinite(configuredSize) ? configuredSize : 1))
                const entries = this._takeQueue(batchSize)
                if (entries.length === 0) {
                    return
                }
                this._activeEntries = entries
                this._activeBytes = entries.reduce((total, entry) => total + entry[2], 0)
                let result: LaneDeliveryResult<E> | void = undefined
                try {
                    result = await attached[0].deliver(
                        entries.map((entry) => entry[1]),
                        { signal: controller?.signal, canContinue }
                    )
                } catch (error) {
                    this._reportError(error)
                } finally {
                    const retryGeneration = this._generation
                    let retryEntries: QueueEntry<E>[] = []
                    if (this._requeueActive) {
                        try {
                            const retry = result?.retry
                            if (Array.isArray(retry)) {
                                const selected: QueueEntry<E>[] = []
                                const length = Math.min(retry.length, entries.length)
                                for (let index = 0; index < length; index++) {
                                    const retryEvent = retry[index]
                                    const entry = entries.find(
                                        (candidate) => candidate[1] === retryEvent && !selected.includes(candidate)
                                    )
                                    if (entry) {
                                        selected.push(entry)
                                    }
                                }
                                retryEntries = entries.filter((entry) => selected.includes(entry))
                            }
                        } catch (error) {
                            retryEntries = []
                            this._reportError(error)
                        }
                    }

                    this._activeEntries = undefined
                    this._activeBytes = 0
                    if (
                        retryEntries.length > 0 &&
                        !this._disposed &&
                        this._requeueActive &&
                        retryGeneration === this._generation
                    ) {
                        const now = this._now()
                        const expired: QueueEntry<E>[] = []
                        const retained: QueueEntry<E>[] = []
                        for (const entry of retryEntries) {
                            ;(this._isExpired(entry, now) ? expired : retained).push(entry)
                        }

                        this._queue.unshift(...retained)
                        this._queuedBytes += retained.reduce((total, entry) => total + entry[2], 0)
                        const completionGeneration = this._generation
                        if (expired.length > 0) {
                            this._reportDrop(expired.length, 'expired')
                        }
                        if (completionGeneration === this._generation) {
                            this._trimQueue()
                            this._updateSettled()
                        }
                    } else {
                        this._updateSettled()
                    }
                    this._reportAvailable()
                }
            })
            .finally(() => {
                if (this._abort === controller) {
                    this._abort = undefined
                }
                if (this._drainingDelivery === attached) {
                    this._drainingDelivery = undefined
                    this._requeueActive = false
                }
                this._drain = undefined
                if (!this._delivery) {
                    this._resolveFlushWaiters(true)
                }
                this._startDrain()
            })
    }
}
