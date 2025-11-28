import { logger } from './logger'
import { isNullish } from '@posthog/core'
import { _cancelIdleCallback, _requestIdleCallback } from './globals'

export type Priority = 'high' | 'normal'

export interface ProcessEachOptions<R> {
    priority?: Priority
    onComplete?: (results: R[]) => void
}

type ScheduleHandle = number | ReturnType<typeof setTimeout>

const DEFAULT_TIME_BUDGET_MS = 30

class Scheduler {
    private _highQueue: Array<() => void> = []
    private _normalQueue: Array<() => void> = []
    private _highScheduled: ScheduleHandle | null = null
    private _normalScheduled: ScheduleHandle | null = null

    processEach<T, R>(items: T[], fn: (item: T, index: number) => R, options?: ProcessEachOptions<R>): void {
        if (items.length === 0) {
            options?.onComplete?.([])
            return
        }

        const results: R[] = new Array(items.length)
        let completedCount = 0
        const isHighPriority = options?.priority === 'high'
        const queue = isHighPriority ? this._highQueue : this._normalQueue

        items.forEach((item, index) => {
            queue.push(() => {
                try {
                    results[index] = fn(item, index)
                } finally {
                    if (++completedCount === items.length) {
                        options?.onComplete?.(results)
                    }
                }
            })
        })

        if (isHighPriority) {
            // High priority uses setTimeout(0) for guaranteed next-tick execution.
            // Critical for operations like flushing events on page unload where
            // we can't wait for browser idle time.
            if (isNullish(this._highScheduled)) {
                this._highScheduled = setTimeout(() => this._processHigh(), 0)
            }
        } else {
            // Normal priority uses requestIdleCallback to avoid interfering with
            // user interactions. The browser will run these when idle.
            if (isNullish(this._normalScheduled)) {
                this._normalScheduled = _requestIdleCallback((deadline) => this._processNormal(deadline))
            }
        }
    }

    private _processHigh(): void {
        this._highScheduled = null

        // eslint-disable-next-line compat/compat
        const start = performance.now()

        while (this._highQueue.length > 0) {
            // eslint-disable-next-line compat/compat
            if (performance.now() - start >= DEFAULT_TIME_BUDGET_MS) {
                this._highScheduled = setTimeout(() => this._processHigh(), 0)
                return
            }

            const task = this._highQueue.shift()
            try {
                task?.()
            } catch (error) {
                logger.error('Error processing task:', error)
            }
        }
    }

    private _processNormal(deadline: { timeRemaining: () => number }): void {
        this._normalScheduled = null

        while (this._normalQueue.length > 0) {
            // Always let high priority tasks run first
            if (this._highQueue.length > 0) {
                this._normalScheduled = _requestIdleCallback((d) => this._processNormal(d))
                return
            }

            if (deadline.timeRemaining() <= 0) {
                this._normalScheduled = _requestIdleCallback((d) => this._processNormal(d))
                return
            }

            const task = this._normalQueue.shift()
            try {
                task?.()
            } catch (error) {
                logger.error('Error processing task:', error)
            }
        }
    }

    _reset(): void {
        this._highQueue = []
        this._normalQueue = []
        if (!isNullish(this._highScheduled)) {
            clearTimeout(this._highScheduled as ReturnType<typeof setTimeout>)
            this._highScheduled = null
        }
        if (!isNullish(this._normalScheduled)) {
            _cancelIdleCallback(this._normalScheduled)
            this._normalScheduled = null
        }
    }
}

export const scheduler = new Scheduler()
