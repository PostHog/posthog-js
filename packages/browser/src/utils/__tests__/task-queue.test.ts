import { TaskQueue, processWithYield, processAsyncWithYield } from '../task-queue'

describe('TaskQueue', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    describe('basic functionality', () => {
        it('processes tasks in FIFO order', () => {
            const results: number[] = []
            const queue = new TaskQueue()

            queue.enqueue(() => results.push(1))
            queue.enqueue(() => results.push(2))
            queue.enqueue(() => results.push(3))

            jest.runAllTimers()

            expect(results).toEqual([1, 2, 3])
        })

        it('starts processing immediately when first task is enqueued', () => {
            const results: number[] = []
            const queue = new TaskQueue()

            queue.enqueue(() => results.push(1))

            // Should process synchronously without timers if within budget
            expect(results).toEqual([1])
        })

        it('reports pending task count', () => {
            const queue = new TaskQueue()

            expect(queue.pending).toBe(0)

            queue.enqueue(() => {})
            queue.enqueue(() => {})

            jest.runAllTimers()

            expect(queue.pending).toBe(0)
        })

        it('reports processing status', () => {
            const queue = new TaskQueue()

            expect(queue.isProcessing).toBe(false)

            queue.enqueue(() => {})

            jest.runAllTimers()

            expect(queue.isProcessing).toBe(false)
        })

        it('enqueues multiple tasks at once', () => {
            const results: number[] = []
            const queue = new TaskQueue()

            queue.enqueueAll([() => results.push(1), () => results.push(2), () => results.push(3)])

            jest.runAllTimers()

            expect(results).toEqual([1, 2, 3])
        })
    })

    describe('time-slicing and yielding', () => {
        it('processes all tasks eventually', () => {
            const queue = new TaskQueue({ timeBudgetMs: 30 })
            const results: number[] = []

            for (let i = 0; i < 10; i++) {
                queue.enqueue(() => results.push(i))
            }

            jest.runAllTimers()

            expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
        })

        it('processes synchronously when within budget', () => {
            const queue = new TaskQueue({ timeBudgetMs: 1000 })
            const results: number[] = []

            // Just a few tasks that won't exceed budget
            for (let i = 0; i < 3; i++) {
                queue.enqueue(() => results.push(i))
            }

            // All should process synchronously without needing to run timers
            expect(results).toEqual([0, 1, 2])
        })
    })

    describe('error handling', () => {
        it('continues processing after task error', () => {
            const results: number[] = []
            const errors: Error[] = []
            const queue = new TaskQueue({
                onError: (error) => errors.push(error),
            })

            queue.enqueue(() => results.push(1))
            queue.enqueue(() => {
                throw new Error('Task failed')
            })
            queue.enqueue(() => results.push(3))

            jest.runAllTimers()

            expect(results).toEqual([1, 3])
            expect(errors).toHaveLength(1)
        })

        it('calls custom error handler when provided', () => {
            const errors: Error[] = []
            const queue = new TaskQueue({
                onError: (error) => errors.push(error),
            })

            const expectedError = new Error('Custom error')
            queue.enqueue(() => {
                throw expectedError
            })

            jest.runAllTimers()

            expect(errors).toHaveLength(1)
            expect(errors[0]).toBe(expectedError)
        })

        it('logs using SDK logger when no error handler provided', () => {
            // The SDK logger will handle the error internally
            // We just verify the queue continues processing
            const results: number[] = []
            const queue = new TaskQueue()

            queue.enqueue(() => results.push(1))
            queue.enqueue(() => {
                throw new Error('Test error')
            })
            queue.enqueue(() => results.push(3))

            jest.runAllTimers()

            // Should process tasks before and after the error
            expect(results).toEqual([1, 3])
        })
    })

    describe('completion callback', () => {
        it('calls onComplete when all tasks finish', () => {
            let completed = false
            let reportedTime = 0
            const queue = new TaskQueue({
                onComplete: (timeMs) => {
                    completed = true
                    reportedTime = timeMs
                },
            })

            queue.enqueueAll([() => {}, () => {}, () => {}])

            jest.runAllTimers()

            expect(completed).toBe(true)
            expect(reportedTime).toBeGreaterThanOrEqual(0)
        })

        it('reports processing time', () => {
            let reportedTime = 0
            const queue = new TaskQueue({
                onComplete: (timeMs) => {
                    reportedTime = timeMs
                },
            })

            queue.enqueueAll([() => {}, () => {}])

            jest.runAllTimers()

            expect(reportedTime).toBeGreaterThanOrEqual(0)
        })
    })
})

describe('processWithYield', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('processes array items and returns results', async () => {
        const items = [1, 2, 3, 4, 5]
        const promise = processWithYield(items, (x) => x * 2)

        jest.runAllTimers()

        const results = await promise
        expect(results).toEqual([2, 4, 6, 8, 10])
    })

    it('preserves array indices', async () => {
        const items = ['a', 'b', 'c']
        const promise = processWithYield(items, (item, index) => `${index}:${item}`)

        jest.runAllTimers()

        const results = await promise
        expect(results).toEqual(['0:a', '1:b', '2:c'])
    })

    it('yields for large arrays', async () => {
        const items = new Array(100).fill(0).map((_, i) => i)

        let mockTime = 0
        jest.spyOn(performance, 'now').mockImplementation(() => mockTime)

        const promise = processWithYield(
            items,
            (x) => {
                mockTime += 1 // Each item takes 1ms
                return x * 2
            },
            { timeBudgetMs: 30 }
        )

        jest.runAllTimers()

        const results = await promise
        expect(results).toHaveLength(100)
        expect(results[0]).toBe(0)
        expect(results[99]).toBe(198)
    })

    it('calls onComplete with processing time', async () => {
        let completedTime = 0
        const items = [1, 2, 3]

        const promise = processWithYield(items, (x) => x * 2, {
            onComplete: (timeMs) => {
                completedTime = timeMs
            },
        })

        jest.runAllTimers()

        await promise
        expect(completedTime).toBeGreaterThanOrEqual(0)
    })
})

describe('processAsyncWithYield', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('processes async tasks sequentially', async () => {
        const results: number[] = []
        const tasks = [
            async () => {
                results.push(1)
                return 1
            },
            async () => {
                results.push(2)
                return 2
            },
            async () => {
                results.push(3)
                return 3
            },
        ]

        const promise = processAsyncWithYield(tasks)

        jest.runAllTimers()
        await promise

        expect(results).toEqual([1, 2, 3])
    })

    it('returns results from async tasks', async () => {
        const tasks = [async () => 'a', async () => 'b', async () => 'c']

        const promise = processAsyncWithYield(tasks)

        jest.runAllTimers()
        const results = await promise

        expect(results).toEqual(['a', 'b', 'c'])
    })

    it('processes all async tasks', async () => {
        const tasks = new Array(10).fill(0).map((_, i) => async () => i)

        const results = await processAsyncWithYield(tasks, { timeBudgetMs: 30 })

        expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })

    it('handles async task errors with custom handler', async () => {
        const errors: Error[] = []
        const expectedError = new Error('Async task failed')

        const tasks = [
            async () => 1,
            async () => {
                throw expectedError
            },
            async () => 3,
        ]

        const promise = processAsyncWithYield(tasks, {
            onError: (error) => errors.push(error),
        })

        jest.runAllTimers()
        await promise

        expect(errors).toHaveLength(1)
        expect(errors[0]).toBe(expectedError)
    })

    it('calls onComplete with total time', async () => {
        let completedTime = 0

        let mockTime = 0
        jest.spyOn(performance, 'now').mockImplementation(() => mockTime)

        const tasks = [
            async () => {
                mockTime += 10
                return 1
            },
            async () => {
                mockTime += 20
                return 2
            },
        ]

        const promise = processAsyncWithYield(tasks, {
            onComplete: (timeMs) => {
                completedTime = timeMs
            },
        })

        jest.runAllTimers()
        await promise

        expect(completedTime).toBe(30)
    })
})
