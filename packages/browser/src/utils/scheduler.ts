import { logger } from './logger'
import { isNullish } from '@posthog/core'

export type Priority = 'high' | 'normal'

const DEFAULT_TIME_BUDGET_MS = 30

class Scheduler {
    private _highQueue: Array<() => void> = []
    private _normalQueue: Array<() => void> = []
    private _scheduled: ReturnType<typeof setTimeout> | null = null
    private _timeBudgetMs = DEFAULT_TIME_BUDGET_MS

    processEach<T, R>(items: T[], fn: (item: T, index: number) => R, options?: { priority?: Priority }): Promise<R[]> {
        if (items.length === 0) {
            // eslint-disable-next-line compat/compat
            return Promise.resolve([])
        }

        const results: R[] = new Array(items.length)
        let completedCount = 0
        const queue = options?.priority === 'high' ? this._highQueue : this._normalQueue

        // eslint-disable-next-line compat/compat
        return new Promise((resolve) => {
            items.forEach((item, index) => {
                queue.push(() => {
                    try {
                        results[index] = fn(item, index)
                    } finally {
                        if (++completedCount === items.length) {
                            resolve(results)
                        }
                    }
                })
            })

            if (isNullish(this._scheduled)) {
                this._scheduled = setTimeout(() => this._process(), 0)
            }
        })
    }

    private _process(): void {
        this._scheduled = null

        // eslint-disable-next-line compat/compat
        const batchStartTime = performance.now()

        while (this._highQueue.length > 0 || this._normalQueue.length > 0) {
            // eslint-disable-next-line compat/compat
            if (performance.now() - batchStartTime >= this._timeBudgetMs) {
                this._scheduled = setTimeout(() => this._process(), 0)
                return
            }

            const task = this._highQueue.shift() ?? this._normalQueue.shift()
            try {
                task?.()
            } catch (error) {
                logger.error('Error processing task:', error)
            }
        }
    }

    _reset(timeBudgetMs = DEFAULT_TIME_BUDGET_MS): void {
        this._highQueue = []
        this._normalQueue = []
        if (!isNullish(this._scheduled)) {
            clearTimeout(this._scheduled)
            this._scheduled = null
        }
        this._timeBudgetMs = timeBudgetMs
    }
}

export const scheduler = new Scheduler()
