/* eslint-disable compat/compat */
import { scheduler } from '../scheduler'

describe('Scheduler', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        scheduler._reset()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    describe('processEach', () => {
        it.each([
            { items: [1, 2, 3, 4, 5], expected: [2, 4, 6, 8, 10] },
            { items: [10], expected: [20] },
        ])('returns results in order for $items', async ({ items, expected }) => {
            const promise = scheduler.processEach(items, (x) => x * 2)
            jest.runAllTimers()
            expect(await promise).toEqual(expected)
        })

        it('provides index to callback', async () => {
            const promise = scheduler.processEach(['a', 'b', 'c'], (item, index) => `${index}:${item}`)
            jest.runAllTimers()
            expect(await promise).toEqual(['0:a', '1:b', '2:c'])
        })

        it('handles empty array', async () => {
            const results = await scheduler.processEach([], (x) => x)
            expect(results).toEqual([])
        })

        it('continues processing after task error', async () => {
            const results: number[] = []
            const promise = scheduler.processEach([1, 2, 3], (x) => {
                if (x === 2) throw new Error('fail')
                results.push(x)
                return x
            })
            jest.runAllTimers()
            await promise
            expect(results).toEqual([1, 3])
        })
    })

    describe('priority', () => {
        it('processes high priority before normal priority', async () => {
            const order: string[] = []

            scheduler.processEach(['n1', 'n2'], (x) => {
                order.push(x)
                return x
            })

            scheduler.processEach(
                ['h1', 'h2'],
                (x) => {
                    order.push(x)
                    return x
                },
                { priority: 'high' }
            )

            jest.runAllTimers()
            // eslint-disable-next-line compat/compat
            await Promise.resolve()

            expect(order).toEqual(['h1', 'h2', 'n1', 'n2'])
        })
    })

    describe('yielding', () => {
        it('yields to browser after time budget exceeded', async () => {
            let mockTime = 0
            jest.spyOn(performance, 'now').mockImplementation(() => mockTime)
            scheduler._reset(30)

            const results: number[] = []
            const items = new Array(100).fill(0).map((_, i) => i)

            scheduler.processEach(items, (x) => {
                mockTime += 1
                results.push(x)
                return x
            })

            // First tick - should process ~30 items then yield
            jest.advanceTimersByTime(0)
            // eslint-disable-next-line compat/compat
            await Promise.resolve()
            expect(results.length).toBeLessThan(100)

            // Complete all
            jest.runAllTimers()
            // eslint-disable-next-line compat/compat
            await Promise.resolve()
            expect(results).toHaveLength(100)
        })
    })
})
