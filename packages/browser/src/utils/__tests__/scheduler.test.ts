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
        ])('returns results in order for $items', ({ items, expected }) => {
            let completedResults: number[] | undefined
            scheduler.processEach(items, (x) => x * 2, {
                onComplete: (results) => {
                    completedResults = results
                },
            })
            jest.runAllTimers()
            expect(completedResults).toEqual(expected)
        })

        it('provides index to callback', () => {
            let completedResults: string[] | undefined
            scheduler.processEach(['a', 'b', 'c'], (item, index) => `${index}:${item}`, {
                onComplete: (results) => {
                    completedResults = results
                },
            })
            jest.runAllTimers()
            expect(completedResults).toEqual(['0:a', '1:b', '2:c'])
        })

        it('handles empty array', () => {
            let completedResults: unknown[] | undefined
            scheduler.processEach([], (x) => x, {
                onComplete: (results) => {
                    completedResults = results
                },
            })
            expect(completedResults).toEqual([])
        })

        it('continues processing after task error', () => {
            const results: number[] = []
            scheduler.processEach([1, 2, 3], (x) => {
                if (x === 2) throw new Error('fail')
                results.push(x)
                return x
            })
            jest.runAllTimers()
            expect(results).toEqual([1, 3])
        })
    })

    describe('priority', () => {
        it('processes high priority before normal priority', () => {
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

            expect(order).toEqual(['h1', 'h2', 'n1', 'n2'])
        })
    })

    describe('yielding', () => {
        it('yields to browser after time budget exceeded (high priority)', () => {
            let mockTime = 0
            jest.spyOn(performance, 'now').mockImplementation(() => mockTime)

            const results: number[] = []
            const items = new Array(100).fill(0).map((_, i) => i)

            scheduler.processEach(
                items,
                (x) => {
                    mockTime += 1
                    results.push(x)
                    return x
                },
                { priority: 'high' }
            )

            jest.advanceTimersByTime(0)
            expect(results.length).toBeLessThan(100)

            jest.runAllTimers()
            expect(results).toHaveLength(100)
        })

        it('yields to browser after time budget exceeded (normal priority)', () => {
            let mockTime = 0
            jest.spyOn(Date, 'now').mockImplementation(() => mockTime)

            const results: number[] = []
            const items = new Array(100).fill(0).map((_, i) => i)

            scheduler.processEach(items, (x) => {
                mockTime += 2
                results.push(x)
                return x
            })

            jest.advanceTimersByTime(0)
            expect(results.length).toBeLessThan(100)

            jest.runAllTimers()
            expect(results).toHaveLength(100)
        })
    })
})
