export interface LaneDeliveryContext {
    readonly signal: AbortSignal | undefined
    canContinue(): boolean
}

export interface LaneDeliveryResult<E> {
    readonly retry: readonly E[]
}

export interface LaneDelivery<E> {
    readonly batchSize?: number
    readonly flushAt?: number
    readonly flushInterval?: number
    canDeliver?(): boolean
    deliver(events: readonly E[], context: LaneDeliveryContext): Promise<LaneDeliveryResult<E> | void>
    teardown?(events: readonly E[], maxBytes: number): void
}

type LaneDropReason = 'overflow' | 'expired' | 'oversized'

type QueueEntry<E> = [
    id: number,
    event: E,
    bytes: number,
    admittedAt: number,
    lastAttemptEpoch: number,
    retryAfter: number,
]
type FlushWaiter = [target: number, epoch: number, resolve: () => void]

/** Package-private bounded admission queue with one client-owned delivery policy. */
export class Lane<E> {
    private readonly _queue: QueueEntry<E>[] = []
    private readonly _flushWaiters: FlushWaiter[] = []
    private _delivery: LaneDelivery<E> | undefined
    private _activeEntries: QueueEntry<E>[] | undefined
    private _drain: Promise<void> | undefined
    private _abort: AbortController | undefined
    private _timer: ReturnType<typeof globalThis.setTimeout> | undefined
    private _retryBlocked = false
    private _disposed = false
    private _dropped = 0
    private _nextId = 0
    private _settledId = 0
    private _generation = 0
    private _driveEpoch = 0
    private _activeEpoch = 0
    private _forceTarget: number | undefined
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

        this._queue.push([++this._nextId, event, eventBytes, now, 0, 0])
        this._queuedBytes += eventBytes
        if (this._retryBlocked && this._queue.length >= this._readFlushAt(this._delivery)) {
            this._retryBlocked = false
        }
        this._schedule()
        return true
    }

    discardQueued(event: E): boolean {
        for (let index = this._queue.length - 1; index >= 0; index--) {
            const entry = this._queue[index]!
            if (entry[1] === event) {
                this._queue.splice(index, 1)
                this._queuedBytes -= entry[2]
                this._updateSettled()
                if (this._queue.length === 0) {
                    this._clearTimer()
                }
                return true
            }
        }
        return false
    }

    hasDelivery(): boolean {
        return !this._disposed && this._delivery !== undefined
    }

    hasPending(): boolean {
        if (this._disposed) {
            return false
        }
        this._expireQueue(this._now())
        return this._activeEntries !== undefined || this._queue.length > 0
    }

    attach(delivery: LaneDelivery<E>): void {
        if (this._disposed) {
            throw new Error('The lane is disposed')
        }
        if (this._delivery) {
            throw new Error('A delivery policy is already installed')
        }
        this._delivery = delivery
        this._retryBlocked = false
        this._expireQueue(this._now())
        this._schedule()
    }

    purge(): void {
        this._generation++
        this._retryBlocked = false
        this._forceTarget = undefined
        this._clearTimer()
        this._cancelActive()
        this._activeEntries = undefined
        this._activeBytes = 0
        this._queue.splice(0)
        this._queuedBytes = 0
        this._updateSettled()
        this._resolveFlushWaiters(true)
    }

    flush(): Promise<void> {
        this._expireQueue(this._now())
        const attached = this._delivery
        if (!attached || (!this._activeEntries && this._queue.length === 0) || !this._canDeliver(attached)) {
            return Promise.resolve()
        }

        const target = this._nextId
        this._retryBlocked = false
        this._clearTimer()
        this._forceTarget = Math.max(this._forceTarget ?? 0, target)
        const epoch = this._drain ? this._activeEpoch : this._beginDrive(true)
        if (!epoch) {
            return Promise.resolve()
        }
        return new Promise((resolve) => {
            this._flushWaiters.push([target, epoch, resolve])
            this._resolveFlushWaiters(false)
        })
    }

    /** Pauses scheduled work while preserving active and queued accounting. */
    pause(): void {
        this._clearTimer()
    }

    /** Redrives retained work after a connectivity transition. */
    retryNow(): void {
        if (this._disposed || this._queue.length === 0) {
            return
        }
        this._retryBlocked = false
        this._clearTimer()
        if (!this._drain) {
            this._beginDrive(true)
        }
    }

    /** Synchronously initiates best-effort teardown delivery without mutating retained work. */
    teardown(maxBytes: number): void {
        this._expireQueue(this._now())
        const attached = this._delivery
        if (this._disposed || !attached || !this._canDeliver(attached)) {
            return
        }
        let teardown: LaneDelivery<E>['teardown']
        try {
            teardown = attached.teardown
        } catch (error) {
            this._reportError(error)
            return
        }
        if (!teardown) {
            return
        }
        const entries = [...(this._activeEntries ?? []), ...this._queue]
        if (entries.length === 0) {
            return
        }
        try {
            teardown(
                entries.map((entry) => entry[1]),
                Math.max(0, Math.floor(Number.isFinite(maxBytes) ? maxBytes : 0))
            )
        } catch (error) {
            this._reportError(error)
        }
    }

    async dispose(): Promise<void> {
        if (this._disposed) {
            return
        }
        this._disposed = true
        this._delivery = undefined
        this.purge()
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

    private _clearTimer(): void {
        const timer = this._timer
        this._timer = undefined
        if (timer !== undefined) {
            try {
                globalThis.clearTimeout(timer)
            } catch {
                // Token and generation checks keep stale timer callbacks harmless.
            }
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
        if (this._forceTarget !== undefined && this._settledId >= this._forceTarget) {
            this._forceTarget = undefined
        }
        if (!this._drain) {
            this._resolveFlushWaiters(false)
        }
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
            const [target, epoch, resolve] = this._flushWaiters[index]!
            let complete = force
            if (!complete) {
                const active = this._activeEntries?.[0]
                if (active && active[0] <= target) {
                    complete = false
                } else {
                    const queued = this._queue[0]
                    complete = !queued || queued[0] > target || queued[4] >= epoch
                }
            }
            if (complete) {
                this._flushWaiters.splice(index, 1)
                resolve()
            }
        }
    }

    private _readNumber(get: () => number | undefined, fallback: number, minimum: number): number {
        try {
            const value = get()
            return Math.max(minimum, Math.floor(Number.isFinite(value) ? value! : fallback))
        } catch (error) {
            this._reportError(error)
            return fallback
        }
    }

    private _readFlushAt(attached: LaneDelivery<E> | undefined): number {
        return attached ? this._readNumber(() => attached.flushAt, 1, 1) : 1
    }

    private _readFlushInterval(attached: LaneDelivery<E>): number {
        return this._readNumber(() => attached.flushInterval, 0, 0)
    }

    private _readBatchSize(attached: LaneDelivery<E>): number {
        try {
            const value = attached.batchSize
            return value === undefined
                ? this._queue.length
                : Math.max(1, Math.floor(Number.isFinite(value) ? value : 1))
        } catch (error) {
            this._reportError(error)
            return 1
        }
    }

    private _canDeliver(attached: LaneDelivery<E>): boolean {
        try {
            return attached.canDeliver?.() ?? true
        } catch (error) {
            this._reportError(error)
            return false
        }
    }

    private _armTimer(attached: LaneDelivery<E>): void {
        if (this._timer !== undefined || this._disposed || this._queue.length === 0 || !this._canDeliver(attached)) {
            return
        }
        const interval = this._readFlushInterval(attached)
        if (interval <= 0) {
            return
        }
        const head = this._queue[0]!
        const dueAt = head[5] || head[3] + interval
        const delay = Math.max(0, dueAt - this._now())
        const generation = this._generation
        try {
            this._timer = globalThis.setTimeout(() => {
                this._timer = undefined
                if (
                    !this._disposed &&
                    this._delivery === attached &&
                    this._generation === generation &&
                    this._canDeliver(attached)
                ) {
                    this._retryBlocked = false
                    this._beginDrive(true)
                }
            }, delay)
        } catch (error) {
            this._reportError(error)
        }
    }

    private _schedule(): void {
        this._expireQueue(this._now())
        const attached = this._delivery
        if (this._disposed || this._drain || !attached || this._queue.length === 0) {
            if (this._queue.length === 0) {
                this._clearTimer()
            }
            return
        }
        if (!this._canDeliver(attached)) {
            this._clearTimer()
            return
        }
        const forced = this._forceTarget !== undefined && this._queue[0]![0] <= this._forceTarget
        if (forced || (!this._retryBlocked && this._queue.length >= this._readFlushAt(attached))) {
            this._clearTimer()
            this._beginDrive(false)
        } else {
            this._armTimer(attached)
        }
    }

    private _beginDrive(allowOne: boolean): number {
        const attached = this._delivery
        if (this._disposed || this._drain || !attached || this._queue.length === 0 || !this._canDeliver(attached)) {
            return 0
        }
        const epoch = ++this._driveEpoch
        const generation = this._generation
        let controller: AbortController | undefined
        try {
            controller = new AbortController()
        } catch {
            // Generation checks still cancel staged work and future attempts.
        }
        this._abort = controller
        this._activeEpoch = epoch
        const canContinue = (): boolean =>
            !this._disposed &&
            this._delivery === attached &&
            this._generation === generation &&
            !(controller?.signal.aborted ?? false)

        this._drain = Promise.resolve()
            .then(async () => {
                let first = true
                while (canContinue() && this._canDeliver(attached)) {
                    this._expireQueue(this._now())
                    const head = this._queue[0]
                    if (!head || head[4] >= epoch) {
                        break
                    }
                    const forced = this._forceTarget !== undefined && head[0] <= this._forceTarget
                    const threshold = !this._retryBlocked && this._queue.length >= this._readFlushAt(attached)
                    if (!forced && !threshold && !(first && allowOne)) {
                        break
                    }
                    first = false

                    let batchSize = this._readBatchSize(attached)
                    if (forced && this._forceTarget !== undefined) {
                        let throughTarget = 0
                        while (
                            throughTarget < this._queue.length &&
                            this._queue[throughTarget]![0] <= this._forceTarget
                        ) {
                            throughTarget++
                        }
                        batchSize = Math.min(batchSize, Math.max(throughTarget, 1))
                    }
                    const entries = this._takeQueue(batchSize)
                    if (entries.length === 0) {
                        break
                    }
                    this._activeEntries = entries
                    this._activeBytes = entries.reduce((total, entry) => total + entry[2], 0)
                    let result: LaneDeliveryResult<E> | void
                    let deliveryFailed = false
                    try {
                        result = await attached.deliver(
                            entries.map((entry) => entry[1]),
                            { signal: controller?.signal, canContinue }
                        )
                    } catch (error) {
                        deliveryFailed = true
                        result = { retry: entries.map((entry) => entry[1]) }
                        this._reportError(error)
                    }

                    let retryEntries: QueueEntry<E>[] = []
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
                        } else if (deliveryFailed) {
                            retryEntries = entries
                        }
                    } catch (error) {
                        retryEntries = entries
                        this._reportError(error)
                    }

                    this._activeEntries = undefined
                    this._activeBytes = 0
                    if (retryEntries.length > 0 && !this._disposed && canContinue()) {
                        const now = this._now()
                        const expired: QueueEntry<E>[] = []
                        const retained: QueueEntry<E>[] = []
                        const retryAfter = now + this._readFlushInterval(attached)
                        for (const entry of retryEntries) {
                            entry[4] = epoch
                            entry[5] = retryAfter
                            ;(this._isExpired(entry, now) ? expired : retained).push(entry)
                        }
                        const completionGeneration = this._generation
                        this._queue.unshift(...retained)
                        this._queuedBytes += retained.reduce((total, entry) => total + entry[2], 0)
                        if (expired.length > 0) {
                            this._reportDrop(expired.length, 'expired')
                        }
                        if (completionGeneration === this._generation) {
                            this._trimQueue()
                            this._retryBlocked = true
                            this._forceTarget = undefined
                            this._updateSettled()
                        }
                    } else {
                        this._updateSettled()
                    }
                    this._reportAvailable()
                    if (retryEntries.length > 0) {
                        break
                    }
                    this._resolveFlushWaiters(false)
                }
            })
            .finally(() => {
                if (this._abort === controller) {
                    this._abort = undefined
                }
                this._activeEpoch = 0
                this._drain = undefined
                this._resolveFlushWaiters(false)
                if (!this._delivery) {
                    this._forceTarget = undefined
                    this._resolveFlushWaiters(true)
                }
                this._schedule()
            })
        return epoch
    }
}
