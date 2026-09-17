import type { EventBuffer, QueueEntry } from './event-buffer'

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

type FlushWaiter = [target: number, epoch: number, resolve: () => void]

/** Delivery scheduling and finite flush barriers for an existing event buffer. */
export class Lane<E> {
    private readonly _flushWaiters: FlushWaiter[] = []
    private _delivery: LaneDelivery<E> | undefined
    private _drain: Promise<void> | undefined
    private _abort: AbortController | undefined
    private _timer: ReturnType<typeof globalThis.setTimeout> | undefined
    private _retryBlocked = false
    private _settledId = 0
    private _driveEpoch = 0
    private _activeEpoch = 0
    private _forceTarget: number | undefined

    constructor(
        private readonly _buffer: EventBuffer<E>,
        private readonly _onError: (error: unknown) => void = () => {},
        private readonly _onAvailable: () => void = () => {}
    ) {
        _buffer.onChange = (change) => {
            if (change === 'enqueue') {
                if (this._retryBlocked && _buffer._queue.length >= this._readFlushAt(this._delivery)) {
                    this._retryBlocked = false
                }
                this._schedule()
            } else if (change === 'purge') {
                this._retryBlocked = false
                this._forceTarget = undefined
                this._clearTimer()
                this._cancelActive()
            } else {
                this._updateSettled()
                if (change === 'discard' && _buffer._queue.length === 0) {
                    this._clearTimer()
                }
                if (change === 'cleared') {
                    this._resolveFlushWaiters(true)
                }
            }
        }
    }

    attach(delivery: LaneDelivery<E>): void {
        if (this._buffer._disposed) {
            throw new Error('The lane is disposed')
        }
        if (this._delivery) {
            throw new Error('A delivery policy is already installed')
        }
        this._delivery = delivery
        this._retryBlocked = false
        this._buffer._expireQueue(this._buffer._now())
        this._schedule()
    }

    flush(): Promise<void> {
        this._buffer._expireQueue(this._buffer._now())
        const attached = this._delivery
        if (
            !attached ||
            (!this._buffer._activeEntries && this._buffer._queue.length === 0) ||
            !this._canDeliver(attached)
        ) {
            return Promise.resolve()
        }

        const target = this._buffer._nextId
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
        if (this._buffer._disposed || this._buffer._queue.length === 0) {
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
        this._buffer._expireQueue(this._buffer._now())
        const attached = this._delivery
        if (this._buffer._disposed || !attached || !this._canDeliver(attached)) {
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
        const entries = [...(this._buffer._activeEntries ?? []), ...this._buffer._queue]
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
        if (this._buffer._disposed) {
            return
        }
        this._delivery = undefined
        this._buffer.dispose()
        await this._drain
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

    private _trimQueue(): void {
        let remove = 0
        let bytes = this._buffer._queuedBytes
        while (
            remove < this._buffer._queue.length &&
            (this._buffer._queue.length - remove > this._buffer._capacity || bytes > this._buffer._maxBytes)
        ) {
            bytes -= this._buffer._queue[remove]![2]
            remove++
        }
        if (remove > 0) {
            const entries = this._buffer._queue.splice(0, remove)
            this._buffer._queuedBytes = bytes
            this._buffer._drop(entries, 'overflow')
        }
    }

    private _updateSettled(): void {
        const activeId = this._buffer._activeEntries?.[0]?.[0]
        const queuedId = this._buffer._queue[0]?.[0]
        const firstPending =
            activeId === undefined ? queuedId : queuedId === undefined ? activeId : Math.min(activeId, queuedId)
        this._settledId = firstPending === undefined ? this._buffer._nextId : firstPending - 1
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
                const active = this._buffer._activeEntries?.[0]
                if (active && active[0] <= target) {
                    complete = false
                } else {
                    const queued = this._buffer._queue[0]
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
                ? this._buffer._queue.length
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
        if (
            this._timer !== undefined ||
            this._buffer._disposed ||
            this._buffer._queue.length === 0 ||
            !this._canDeliver(attached)
        ) {
            return
        }
        const interval = this._readFlushInterval(attached)
        if (interval <= 0) {
            return
        }
        const head = this._buffer._queue[0]!
        const dueAt = head[5] || head[3] + interval
        const delay = Math.max(0, dueAt - this._buffer._now())
        const generation = this._buffer._generation
        try {
            this._timer = globalThis.setTimeout(() => {
                this._timer = undefined
                if (
                    !this._buffer._disposed &&
                    this._delivery === attached &&
                    this._buffer._generation === generation &&
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
        this._buffer._expireQueue(this._buffer._now())
        const attached = this._delivery
        if (this._buffer._disposed || this._drain || !attached || this._buffer._queue.length === 0) {
            if (this._buffer._queue.length === 0) {
                this._clearTimer()
            }
            return
        }
        if (!this._canDeliver(attached)) {
            this._clearTimer()
            return
        }
        const forced = this._forceTarget !== undefined && this._buffer._queue[0]![0] <= this._forceTarget
        if (forced || (!this._retryBlocked && this._buffer._queue.length >= this._readFlushAt(attached))) {
            this._clearTimer()
            this._beginDrive(false)
        } else {
            this._armTimer(attached)
        }
    }

    private _beginDrive(allowOne: boolean): number {
        const attached = this._delivery
        if (
            this._buffer._disposed ||
            this._drain ||
            !attached ||
            this._buffer._queue.length === 0 ||
            !this._canDeliver(attached)
        ) {
            return 0
        }
        const epoch = ++this._driveEpoch
        const generation = this._buffer._generation
        let controller: AbortController | undefined
        try {
            controller = new AbortController()
        } catch {
            // Generation checks still cancel staged work and future attempts.
        }
        this._abort = controller
        this._activeEpoch = epoch
        const canContinue = (): boolean =>
            !this._buffer._disposed &&
            this._delivery === attached &&
            this._buffer._generation === generation &&
            !(controller?.signal.aborted ?? false)

        this._drain = Promise.resolve()
            .then(async () => {
                let first = true
                while (canContinue() && this._canDeliver(attached)) {
                    this._buffer._expireQueue(this._buffer._now())
                    const head = this._buffer._queue[0]
                    if (!head || head[4] >= epoch) {
                        break
                    }
                    const forced = this._forceTarget !== undefined && head[0] <= this._forceTarget
                    const threshold = !this._retryBlocked && this._buffer._queue.length >= this._readFlushAt(attached)
                    if (!forced && !threshold && !(first && allowOne)) {
                        break
                    }
                    first = false

                    let batchSize = this._readBatchSize(attached)
                    if (forced && this._forceTarget !== undefined) {
                        let throughTarget = 0
                        while (
                            throughTarget < this._buffer._queue.length &&
                            this._buffer._queue[throughTarget]![0] <= this._forceTarget
                        ) {
                            throughTarget++
                        }
                        batchSize = Math.min(batchSize, Math.max(throughTarget, 1))
                    }
                    const entries = this._buffer._takeQueue(batchSize)
                    if (entries.length === 0) {
                        break
                    }
                    this._buffer._activeEntries = entries
                    this._buffer._activeBytes = entries.reduce((total, entry) => total + entry[2], 0)
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

                    this._buffer._activeEntries = undefined
                    this._buffer._activeBytes = 0
                    if (retryEntries.length > 0 && !this._buffer._disposed && canContinue()) {
                        const now = this._buffer._now()
                        const expired: QueueEntry<E>[] = []
                        const retained: QueueEntry<E>[] = []
                        const retryAfter = now + this._readFlushInterval(attached)
                        for (const entry of retryEntries) {
                            entry[4] = epoch
                            entry[5] = retryAfter
                            ;(this._buffer._isExpired(entry, now) ? expired : retained).push(entry)
                        }
                        const completionGeneration = this._buffer._generation
                        this._buffer._queue.unshift(...retained)
                        this._buffer._queuedBytes += retained.reduce((total, entry) => total + entry[2], 0)
                        if (expired.length > 0) {
                            this._buffer._reportDrop(expired.length, 'expired')
                        }
                        if (completionGeneration === this._buffer._generation) {
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
