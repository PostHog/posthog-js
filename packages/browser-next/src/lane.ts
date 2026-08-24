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

type QueueEntry<E> = [id: number, event: E]
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

    constructor(
        private readonly _capacity: number,
        private readonly _onError: (error: unknown) => void,
        private readonly _onDrop: (count: number) => void
    ) {}

    enqueue(event: E): void {
        if (this._disposed) {
            return
        }
        if (this._queue.length === this._capacity) {
            this._drop(this._queue.splice(0, 1))
        }
        this._queue.push([++this._nextId, event])
        this._startDrain()
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
                    this._resolveFlushWaiters(true)
                }
            },
        }
    }

    purge(): void {
        this._generation++
        this._requeueActive = false
        this._cancelActive()
        this._queue.splice(0)
        this._updateSettled()
    }

    flush(): Promise<void> {
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

    private _cancelActive(): void {
        try {
            this._abort?.abort()
        } catch {
            // The generation check remains authoritative when abort throws.
        }
    }

    private _drop(entries: QueueEntry<E>[]): void {
        for (let index = 0; index < entries.length; index++) {
            try {
                this._onDrop(++this._dropped)
            } catch {
                // Reporting must not affect admission.
            }
        }
        this._updateSettled()
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
                const entries = this._queue.splice(0, batchSize)
                if (entries.length === 0) {
                    return
                }
                this._activeEntries = entries
                let result: LaneDeliveryResult<E> | void = undefined
                try {
                    result = await attached[0].deliver(
                        entries.map((entry) => entry[1]),
                        { signal: controller?.signal, canContinue }
                    )
                } catch (error) {
                    this._reportError(error)
                } finally {
                    const retry = this._requeueActive && result?.retry.length ? result.retry : []
                    const retryEntries = entries.filter((entry) => retry.includes(entry[1]))
                    this._activeEntries = undefined
                    if (retryEntries.length > 0 && !this._disposed) {
                        const available = Math.max(0, this._capacity - this._queue.length)
                        const dropped = retryEntries.slice(0, Math.max(0, retryEntries.length - available))
                        const retained = retryEntries.slice(dropped.length)
                        this._queue.unshift(...retained)
                        this._drop(dropped)
                    } else {
                        this._updateSettled()
                    }
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
                this._startDrain()
            })
    }
}
