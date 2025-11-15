/**
 * Scheduler for breaking up CPU-intensive work to avoid blocking the main thread.
 * Uses time-budgeting to yield control back to the browser periodically,
 * improving Interaction to Next Paint (INP) and overall page responsiveness.
 */

import { logger } from './logger'

export interface TaskQueueConfig {
    /**
     * Maximum time (in ms) to spend processing tasks before yielding.
     * Default: 30ms (conservative, allows browser time for rendering and interactions)
     */
    timeBudgetMs?: number

    /**
     * Callback invoked when all tasks have been processed.
     * Receives the total time spent processing tasks.
     */
    onComplete?: (totalTimeMs: number) => void

    /**
     * Callback invoked when a task throws an error.
     * If not provided, errors are logged using the SDK logger.
     */
    onError?: (error: Error, task: () => void) => void
}

export class TaskQueue {
    private _queue: Array<() => void> = []
    private _processing = false
    private _startTime = 0
    private _config: Required<TaskQueueConfig>

    constructor(config: TaskQueueConfig = {}) {
        this._config = {
            timeBudgetMs: config.timeBudgetMs ?? 30,
            onComplete: config.onComplete ?? (() => {}),
            onError:
                config.onError ??
                ((error: Error) => {
                    logger.error('Error processing task:', error)
                }),
        }
    }

    /**
     * Add a task to the queue. Tasks are processed in FIFO order.
     * If the queue is not already processing, processing starts immediately.
     */
    enqueue(task: () => void): void {
        this._queue.push(task)

        if (!this._processing) {
            this._processing = true
            // we don't support IE11 anymore, so performance.now is safe
            // eslint-disable-next-line compat/compat
            this._startTime = performance.now()
            this._process()
        }
    }

    /**
     * Add multiple tasks to the queue at once.
     */
    enqueueAll(tasks: Array<() => void>): void {
        this._queue.push(...tasks)

        if (!this._processing) {
            this._processing = true
            // we don't support IE11 anymore, so performance.now is safe
            // eslint-disable-next-line compat/compat
            this._startTime = performance.now()
            this._process()
        }
    }

    /**
     * Returns the number of pending tasks in the queue.
     */
    get pending(): number {
        return this._queue.length
    }

    /**
     * Returns whether the queue is currently processing tasks.
     */
    get isProcessing(): boolean {
        return this._processing
    }

    private _process(): void {
        // we don't support IE11 anymore, so performance.now is safe
        // eslint-disable-next-line compat/compat
        const batchStartTime = performance.now()

        while (this._queue.length > 0) {
            // we don't support IE11 anymore, so performance.now is safe
            // eslint-disable-next-line compat/compat
            const elapsed = performance.now() - batchStartTime

            if (elapsed >= this._config.timeBudgetMs) {
                // Exceeded time budget, yield to browser
                setTimeout(() => {
                    this._process()
                }, 0)
                return
            }

            const task = this._queue.shift()
            if (task) {
                try {
                    task()
                } catch (error) {
                    this._config.onError(error as Error, task)
                }
            }
        }

        // All tasks complete
        // we don't support IE11 anymore, so performance.now is safe
        // eslint-disable-next-line compat/compat
        const totalTime = Math.round(performance.now() - this._startTime)
        this._processing = false
        this._config.onComplete(totalTime)
    }
}

/**
 * Process an array of items with a transformation function, yielding to the main thread
 * periodically to avoid blocking. Returns a promise that resolves when all items are processed.
 *
 * @param items - Array of items to process
 * @param fn - Function to apply to each item
 * @param config - Optional task queue configuration
 * @returns Promise that resolves with array of results when processing completes
 */
export function processWithYield<T, R>(
    items: T[],
    fn: (item: T, index: number) => R,
    config?: TaskQueueConfig
): // eslint-disable-next-line compat/compat
Promise<R[]> {
    // eslint-disable-next-line compat/compat
    return new Promise((resolve) => {
        const results: R[] = []
        const queue = new TaskQueue({
            ...config,
            onComplete: (totalTimeMs) => {
                config?.onComplete?.(totalTimeMs)
                resolve(results)
            },
        })

        items.forEach((item, index) => {
            queue.enqueue(() => {
                results[index] = fn(item, index)
            })
        })
    })
}

/**
 * Runs async tasks sequentially with yielding between each task.
 * Unlike processWithYield, this supports async functions and waits for each to complete.
 *
 * @param tasks - Array of async functions to execute
 * @param config - Optional task queue configuration
 * @returns Promise that resolves when all tasks complete
 */
export async function processAsyncWithYield<T>(tasks: Array<() => Promise<T>>, config?: TaskQueueConfig): Promise<T[]> {
    const results: T[] = []
    const timeBudgetMs = config?.timeBudgetMs ?? 30
    // we don't support IE11 anymore, so performance.now is safe
    // eslint-disable-next-line compat/compat
    const startTime = performance.now()
    // eslint-disable-next-line compat/compat
    let batchStartTime = performance.now()

    for (let i = 0; i < tasks.length; i++) {
        // we don't support IE11 anymore, so performance.now is safe
        // eslint-disable-next-line compat/compat
        const elapsed = performance.now() - batchStartTime

        if (elapsed >= timeBudgetMs && i < tasks.length) {
            // Yield to browser
            // eslint-disable-next-line compat/compat
            await new Promise((resolve) => setTimeout(resolve, 0))
            // eslint-disable-next-line compat/compat
            batchStartTime = performance.now()
        }

        try {
            results[i] = await tasks[i]()
        } catch (error) {
            if (config?.onError) {
                config.onError(error as Error, tasks[i])
            } else {
                logger.error('Error processing async task:', error)
            }
        }
    }

    // we don't support IE11 anymore, so performance.now is safe
    // eslint-disable-next-line compat/compat
    const totalTime = Math.round(performance.now() - startTime)
    config?.onComplete?.(totalTime)

    return results
}
