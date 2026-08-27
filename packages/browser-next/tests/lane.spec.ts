import type { LaneDelivery } from '../src/lane'
import { Lane } from '../src/lane'

const createLane = <E>(capacity = 10): Lane<E> =>
    new Lane(
        capacity,
        () => {},
        () => {}
    )

describe('Lane', () => {
    it('retains admitted events until delivery is installed', async () => {
        const batches: string[][] = []
        const lane = createLane<string>()
        lane.enqueue('first')

        await lane.flush()
        expect(batches).toEqual([])

        lane.attach({
            async deliver(events) {
                batches.push([...events])
            },
        })
        await lane.flush()

        expect(batches).toEqual([['first']])
    })

    it('preserves FIFO order for admissions made during an active drain', async () => {
        let release: (() => void) | undefined
        const firstDelivery = new Promise<void>((resolve) => {
            release = resolve
        })
        const batches: string[][] = []
        const lane = createLane<string>()
        lane.enqueue('first')
        lane.enqueue('second')
        lane.attach({
            async deliver(events) {
                batches.push([...events])
                if (batches.length === 1) {
                    await firstDelivery
                }
            },
        })
        await Promise.resolve()
        lane.enqueue('third')

        expect(batches).toEqual([['first', 'second']])
        release?.()
        await lane.flush()

        expect(batches.flat()).toEqual(['first', 'second', 'third'])
    })

    it('invalidates a staged batch when the queue is purged', async () => {
        const delivered: string[] = []
        const lane = createLane<string>()
        lane.attach({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        lane.enqueue('private')

        lane.purge()
        await lane.flush()

        expect(delivered).toEqual([])
    })

    it('drops the oldest event when its count bound is reached', async () => {
        const drops: number[] = []
        const delivered: string[] = []
        const lane = new Lane<string>(
            2,
            () => {},
            (count) => drops.push(count)
        )
        lane.enqueue('oldest')
        lane.enqueue('middle')
        lane.enqueue('newest')
        lane.attach({
            async deliver(events) {
                delivered.push(...events)
            },
        })

        await lane.flush()

        expect(delivered).toEqual(['middle', 'newest'])
        expect(drops).toEqual([1])
    })

    it('admits the exact byte boundary and rejects an oversized event without evicting valid work', async () => {
        const drops: Array<[number, number | undefined, string | undefined]> = []
        const delivered: string[] = []
        const lane = new Lane<string>(
            10,
            () => {},
            (total, count, reason) => drops.push([total, count, reason]),
            10
        )

        expect(lane.enqueue('exact', 10)).toBe(true)
        expect(lane.enqueue('oversized', 11)).toBe(false)
        lane.attach({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        await lane.flush()

        expect(delivered).toEqual(['exact'])
        expect(drops).toEqual([[1, 1, 'oversized']])
    })

    it('evicts an oldest byte prefix and reports multiple victims once', async () => {
        const drops: Array<[number, number | undefined, string | undefined]> = []
        const delivered: string[] = []
        const lane = new Lane<string>(
            10,
            () => {},
            (total, count, reason) => drops.push([total, count, reason]),
            10
        )
        lane.enqueue('first', 4)
        lane.enqueue('second', 4)

        expect(lane.enqueue('newest', 7)).toBe(true)
        lane.attach({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        await lane.flush()

        expect(delivered).toEqual(['newest'])
        expect(drops).toEqual([[2, 2, 'overflow']])
    })

    it('expires strictly after the age boundary using admission time', async () => {
        let now = 0
        const drops: string[] = []
        const delivered: string[] = []
        const lane = new Lane<{ name: string; timestamp: number }>(
            10,
            () => {},
            (_total, _count, reason) => drops.push(reason ?? ''),
            100,
            100,
            () => now
        )
        lane.enqueue({ name: 'old', timestamp: Number.MAX_SAFE_INTEGER }, 1)
        now = 100
        await lane.flush()
        expect((lane as unknown as { _queue: unknown[] })._queue).toHaveLength(1)

        now = 101
        await lane.flush()
        lane.attach({
            async deliver(events) {
                delivered.push(...events.map(({ name }) => name))
            },
        })
        await lane.flush()

        expect(delivered).toEqual([])
        expect(drops).toEqual(['expired'])
    })

    it('expires queued work at enqueue and install without a timer', async () => {
        let now = 0
        const delivered: string[] = []
        const lane = new Lane<string>(
            10,
            () => {},
            () => {},
            100,
            100,
            () => now
        )
        lane.enqueue('expired-on-enqueue', 1)
        now = 101
        lane.enqueue('current', 1)
        now = 202
        lane.attach({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        await lane.flush()

        expect(delivered).toEqual([])
    })

    it('expires work before the next drain and resolves its flush barrier', async () => {
        let now = 0
        const delivered: string[] = []
        const lane = new Lane<string>(
            10,
            () => {},
            () => {},
            100,
            100,
            () => now
        )
        lane.attach({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        lane.enqueue('staged', 1)
        const flush = lane.flush()
        now = 101
        await lane.flush()
        await flush

        expect(delivered).toEqual([])
    })

    it('counts active bytes and rejects a new event without evicting queued work', async () => {
        let release: (() => void) | undefined
        const stalled = new Promise<void>((resolve) => {
            release = resolve
        })
        const drops: string[] = []
        const delivered: string[] = []
        const lane = new Lane<string>(
            10,
            () => {},
            (_total, _count, reason) => drops.push(reason ?? ''),
            10
        )
        lane.attach({
            batchSize: 1,
            async deliver(events) {
                delivered.push(...events)
                if (events[0] === 'active') {
                    await stalled
                }
            },
        })
        lane.enqueue('active', 8)
        await Promise.resolve()
        lane.enqueue('queued', 2)

        expect(lane.enqueue('rejected', 3)).toBe(false)
        release?.()
        await lane.flush()

        expect(delivered).toEqual(['active', 'queued'])
        expect(drops).toEqual(['overflow'])
    })

    it('expires a retry and preserves newer queued work', async () => {
        let now = 0
        let finish: ((result: { retry: readonly string[] }) => void) | undefined
        const pending = new Promise<{ retry: readonly string[] }>((resolve) => {
            finish = resolve
        })
        const drops: string[] = []
        const delivered: string[] = []
        const lane = new Lane<string>(
            2,
            () => {},
            (_total, _count, reason) => drops.push(reason ?? ''),
            10,
            100,
            () => now
        )
        lane.attach({
            batchSize: 1,
            flushAt: 100,
            async deliver(events) {
                if (events[0] === 'retry') {
                    return pending
                }
                delivered.push(...events)
            },
        })
        lane.enqueue('retry', 6)
        const firstFlush = lane.flush()
        await Promise.resolve()
        now = 50
        lane.enqueue('newer', 4)
        now = 101
        finish?.({ retry: ['retry'] })
        await firstFlush
        await Promise.resolve()
        await lane.flush()

        expect(delivered).toEqual(['newer'])
        expect(drops).toContain('expired')
    })

    it('retains only unexpired retry entries for a later drive', async () => {
        let now = 0
        let finish: ((result: { retry: readonly string[] }) => void) | undefined
        const pending = new Promise<{ retry: readonly string[] }>((resolve) => {
            finish = resolve
        })
        const delivered: string[] = []
        let calls = 0
        const lane = new Lane<string>(
            3,
            () => {},
            () => {},
            10,
            100,
            () => now
        )
        lane.enqueue('expired', 1)
        now = 50
        lane.enqueue('retained', 1)
        lane.attach({
            batchSize: 2,
            async deliver(events) {
                if (calls++ === 0) {
                    return pending
                }
                delivered.push(...events)
            },
        })
        const flush = lane.flush()
        await Promise.resolve()

        now = 101
        finish?.({ retry: ['expired', 'retained'] })
        await flush
        expect(delivered).toEqual([])

        await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
        await lane.flush()
        expect(delivered).toEqual(['retained'])
    })

    it('does not revive a retained retry when expiry reporting purges the lane', async () => {
        let now = 0
        let finish: ((result: { retry: readonly string[] }) => void) | undefined
        const pending = new Promise<{ retry: readonly string[] }>((resolve) => {
            finish = resolve
        })
        const lane = new Lane<string>(
            3,
            () => {},
            (_total, _count, reason) => {
                if (reason === 'expired') {
                    lane.purge()
                }
            },
            10,
            100,
            () => now
        )
        lane.enqueue('expired', 1)
        now = 50
        lane.enqueue('retained', 1)
        lane.attach({
            batchSize: 2,
            async deliver() {
                return pending
            },
        })

        now = 101
        finish?.({ retry: ['expired', 'retained'] })
        await Promise.resolve()
        await lane.flush()

        expect(lane.hasPending()).toBe(false)
    })

    it('contains hostile retry getters and collections without leaking active bookkeeping', async () => {
        const errors: unknown[] = []
        for (const result of [
            Object.defineProperty({}, 'retry', {
                get() {
                    throw new Error('retry getter failed')
                },
            }),
            {
                retry: new Proxy(['retry'], {
                    get() {
                        throw new Error('retry collection failed')
                    },
                }),
            },
        ]) {
            const lane = new Lane<string>(
                2,
                (error) => errors.push(error),
                () => {},
                10
            )
            lane.attach({
                async deliver() {
                    return result as { retry: readonly string[] }
                },
            })
            lane.enqueue('retry', 5)

            await expect(lane.flush()).resolves.toBeUndefined()
            expect((lane as unknown as { _activeBytes: number })._activeBytes).toBe(0)
            await expect(lane.dispose()).resolves.toBeUndefined()
        }
        expect(errors).toHaveLength(2)
    })

    it('preserves retry multiplicity when active entries share the same value', async () => {
        const delivered: string[] = []
        let calls = 0
        const lane = createLane<string>(3)
        lane.attach({
            batchSize: 2,
            async deliver(events) {
                if (calls++ === 0) {
                    return { retry: [events[0]!] }
                }
                delivered.push(...events)
            },
        })
        lane.enqueue('same')
        lane.enqueue('same')

        await lane.flush()
        expect(delivered).toEqual([])
        await lane.flush()

        expect(delivered).toEqual(['same'])
    })

    it('makes an ignored active delivery terminal for purge barriers and accounting', async () => {
        let release: (() => void) | undefined
        const stalled = new Promise<void>((resolve) => {
            release = resolve
        })
        const lane = new Lane<string>(
            2,
            () => {},
            () => {},
            10
        )
        lane.attach({
            async deliver() {
                await stalled
            },
        })
        lane.enqueue('active', 8)
        await Promise.resolve()
        const flush = lane.flush()

        lane.purge()
        await expect(flush).resolves.toBeUndefined()
        expect((lane as unknown as { _activeBytes: number })._activeBytes).toBe(0)

        release?.()
        await lane.dispose()
    })

    it('resets queued byte state on purge and disposal', async () => {
        const lane = new Lane<string>(
            10,
            () => {},
            () => {},
            10
        )
        lane.enqueue('queued', 8)
        lane.purge()
        expect((lane as unknown as { _queuedBytes: number })._queuedBytes).toBe(0)
        expect(lane.enqueue('replacement', 10)).toBe(true)

        await lane.dispose()

        expect((lane as unknown as { _queuedBytes: number; _activeBytes: number })._queuedBytes).toBe(0)
        expect((lane as unknown as { _activeBytes: number })._activeBytes).toBe(0)
        expect(lane.enqueue('disposed', 1)).toBe(false)
    })

    it('clears active byte state when disposal finishes an in-flight delivery', async () => {
        let release: (() => void) | undefined
        const stalled = new Promise<void>((resolve) => {
            release = resolve
        })
        const lane = new Lane<string>(
            10,
            () => {},
            () => {},
            10
        )
        lane.attach({
            async deliver() {
                await stalled
            },
        })
        lane.enqueue('active', 8)
        await Promise.resolve()
        expect((lane as unknown as { _activeBytes: number })._activeBytes).toBe(8)

        const disposal = lane.dispose()
        release?.()
        await disposal

        expect((lane as unknown as { _queuedBytes: number; _activeBytes: number })._queuedBytes).toBe(0)
        expect((lane as unknown as { _activeBytes: number })._activeBytes).toBe(0)
    })

    it('contains throwing clocks and drop reporters', () => {
        const lane = new Lane<string>(
            1,
            () => {},
            () => {
                throw new Error('reporter failed')
            },
            1,
            1,
            () => {
                throw new Error('clock failed')
            }
        )

        expect(() => lane.enqueue('first', 1)).not.toThrow()
        expect(() => lane.enqueue('oversized', 2)).not.toThrow()
    })

    it('keeps completion bookkeeping bounded while a stalled drain overflows repeatedly', async () => {
        let release: (() => void) | undefined
        const stalled = new Promise<void>((resolve) => {
            release = resolve
        })
        const delivered: string[] = []
        const lane = createLane<string>(1)
        lane.enqueue('active')
        lane.attach({
            batchSize: 1,
            async deliver(events) {
                delivered.push(...events)
                if (events[0] === 'active') {
                    await stalled
                }
            },
        })
        await Promise.resolve()

        for (let index = 0; index < 10_000; index++) {
            lane.enqueue(String(index))
        }

        expect((lane as unknown as { _settledId: number })._settledId).toBe(0)
        expect(Object.values(lane).some((value) => value instanceof Set)).toBe(false)
        const flush = lane.flush()
        release?.()
        await flush

        expect(delivered).toEqual(['active', '9999'])
    })

    it('contains a throwing batch-size getter and falls back to one event', async () => {
        const errors: unknown[] = []
        const delivered: string[][] = []
        const lane = new Lane<string>(
            10,
            (error) => errors.push(error),
            () => {}
        )
        const batchSize = jest.fn(() => {
            throw new Error('batch size failed')
        })
        const delivery: LaneDelivery<string> = {
            get batchSize() {
                return batchSize()
            },
            async deliver(events) {
                delivered.push([...events])
            },
        }
        lane.enqueue('first')
        lane.enqueue('second')
        lane.attach(delivery)

        await lane.flush()
        await expect(lane.dispose()).resolves.toBeUndefined()

        expect(delivered).toEqual([['first'], ['second']])
        expect(batchSize).toHaveBeenCalledTimes(2)
        expect(errors).toHaveLength(2)
    })

    it('flushes only through work admitted before the flush barrier', async () => {
        let releaseFirst: (() => void) | undefined
        let releaseSecond: (() => void) | undefined
        const first = new Promise<void>((resolve) => {
            releaseFirst = resolve
        })
        const second = new Promise<void>((resolve) => {
            releaseSecond = resolve
        })
        let calls = 0
        const lane = createLane<string>()
        lane.attach({
            batchSize: 1,
            async deliver() {
                await (++calls === 1 ? first : second)
            },
        })
        lane.enqueue('before')
        const flush = lane.flush()
        await Promise.resolve()
        lane.enqueue('after')

        releaseFirst?.()
        await flush

        expect(calls).toBeGreaterThanOrEqual(1)
        releaseSecond?.()
        await lane.flush()
    })

    it('purges queued work and ignores admissions after disposal', async () => {
        const delivered: string[] = []
        const lane = createLane<string>()
        lane.enqueue('purged')
        lane.purge()
        lane.attach({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        await lane.dispose()
        lane.enqueue('disposed')
        await lane.flush()

        expect(delivered).toEqual([])
    })

    it('starts delivery at the configured count threshold', async () => {
        const batches: string[][] = []
        const lane = createLane<string>()
        lane.attach({
            flushAt: 3,
            flushInterval: 0,
            async deliver(events) {
                batches.push([...events])
            },
        })

        lane.enqueue('first')
        lane.enqueue('second')
        await Promise.resolve()
        expect(batches).toEqual([])

        lane.enqueue('third')
        await lane.flush()
        expect(batches).toEqual([['first', 'second', 'third']])
    })

    it('starts delivery when the configured interval elapses', async () => {
        jest.useFakeTimers()
        try {
            const batches: string[][] = []
            const lane = createLane<string>()
            lane.attach({
                flushAt: 3,
                flushInterval: 100,
                async deliver(events) {
                    batches.push([...events])
                },
            })
            lane.enqueue('first')

            await jest.advanceTimersByTimeAsync(99)
            expect(batches).toEqual([])
            await jest.advanceTimersByTimeAsync(1)
            expect(batches).toEqual([['first']])
            await lane.dispose()
        } finally {
            jest.useRealTimers()
        }
    })

    it('measures interval delivery from admission across active work and late installation', async () => {
        jest.useFakeTimers({ now: 0 })
        try {
            let release: (() => void) | undefined
            const stalled = new Promise<void>((resolve) => {
                release = resolve
            })
            const batches: string[][] = []
            const lane = createLane<string>()
            lane.attach({
                batchSize: 1,
                flushAt: 2,
                flushInterval: 100,
                async deliver(events) {
                    batches.push([...events])
                    if (events[0] === 'first') {
                        await stalled
                    }
                },
            })
            lane.enqueue('first')
            lane.enqueue('second')
            await jest.advanceTimersByTimeAsync(150)
            expect(batches).toEqual([['first']])

            release?.()
            await jest.advanceTimersByTimeAsync(0)
            expect(batches).toEqual([['first'], ['second']])
            await lane.dispose()

            const backlog: string[][] = []
            const late = createLane<string>()
            late.enqueue('waiting')
            await jest.advanceTimersByTimeAsync(100)
            late.attach({
                flushAt: 2,
                flushInterval: 100,
                async deliver(events) {
                    backlog.push([...events])
                },
            })
            await jest.advanceTimersByTimeAsync(0)
            expect(backlog).toEqual([['waiting']])
            await late.dispose()
        } finally {
            jest.useRealTimers()
        }
    })

    it('waits a fresh interval before automatically redriving retained work', async () => {
        jest.useFakeTimers({ now: 0 })
        try {
            const batches: string[][] = []
            const lane = createLane<string>()
            lane.attach({
                flushAt: 1,
                flushInterval: 100,
                async deliver(events) {
                    batches.push([...events])
                    return batches.length === 1 ? { retry: events } : undefined
                },
            })
            lane.enqueue('retry')
            await lane.flush()
            await Promise.resolve()
            expect(batches).toEqual([['retry']])

            await jest.advanceTimersByTimeAsync(99)
            expect(batches).toEqual([['retry']])
            await jest.advanceTimersByTimeAsync(1)
            expect(batches).toEqual([['retry'], ['retry']])
            await lane.dispose()
        } finally {
            jest.useRealTimers()
        }
    })

    it('retains exhausted work without hot-looping and redrives it on the next flush', async () => {
        const batches: string[][] = []
        const lane = createLane<string>()
        lane.attach({
            flushAt: 1,
            flushInterval: 0,
            async deliver(events) {
                batches.push([...events])
                return batches.length === 1 ? { retry: events } : undefined
            },
        })
        lane.enqueue('retry')

        await lane.flush()
        expect(batches).toEqual([['retry']])
        await Promise.resolve()
        expect(batches).toEqual([['retry']])

        await lane.flush()
        expect(batches).toEqual([['retry'], ['retry']])
    })
})
