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

        lane.install({
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
        lane.install({
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
        lane.install({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        lane.enqueue('private')

        lane.purge()
        await lane.flush()

        expect(delivered).toEqual([])
    })

    it('does not let a stale installation handle detach its replacement', async () => {
        const delivered: string[] = []
        const lane = createLane<string>()
        lane.enqueue('event')
        const first = lane.install({ async deliver() {} })
        first.dispose()
        const secondDelivery: LaneDelivery<string> = {
            async deliver(events) {
                delivered.push(...events)
            },
        }
        lane.install(secondDelivery)

        first.dispose()
        await lane.flush()

        expect(delivered).toEqual(['event'])
    })

    it('counts staged work toward capacity when delivery is detached and replaced', async () => {
        const delivered: string[] = []
        const lane = createLane<string>(2)
        const first = lane.install({ async deliver() {} })
        lane.enqueue('oldest')
        lane.enqueue('middle')

        first.dispose()
        lane.enqueue('newest')
        lane.install({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        await lane.flush()

        expect(delivered).toEqual(['middle', 'newest'])
    })

    it('bounds queued retries separately from active delivery', async () => {
        let finish: ((result: { retry: readonly string[] }) => void) | undefined
        const pending = new Promise<{ retry: readonly string[] }>((resolve) => {
            finish = resolve
        })
        const drops: number[] = []
        const delivered: string[] = []
        const lane = new Lane<string>(
            2,
            () => {},
            (count) => drops.push(count)
        )
        const first = lane.install({
            batchSize: 1,
            async deliver(events) {
                return pending.then(() => ({ retry: events }))
            },
        })
        lane.enqueue('retry')
        await Promise.resolve()
        lane.enqueue('middle')
        lane.enqueue('newest')

        first.dispose()
        lane.install({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        finish?.({ retry: ['retry'] })
        await lane.flush()

        expect(delivered).toEqual(['middle', 'newest'])
        expect(drops).toEqual([1])
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
        lane.install({
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
        lane.install({
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
        lane.install({
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
        lane.install({
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
        lane.install({
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
        lane.install({
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
        lane.install({
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

    it('expires a detached retry and preserves newer queued work', async () => {
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
        const first = lane.install({
            batchSize: 1,
            async deliver() {
                return pending
            },
        })
        lane.enqueue('retry', 6)
        await Promise.resolve()
        now = 50
        lane.enqueue('newer', 4)
        first.dispose()
        lane.install({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        now = 101
        finish?.({ retry: ['retry'] })
        await lane.flush()

        expect(delivered).toEqual(['newer'])
        expect(drops).toContain('expired')
    })

    it('keeps a mixed retained retry pending until replacement delivery settles', async () => {
        let now = 0
        let finish: ((result: { retry: readonly string[] }) => void) | undefined
        let release: (() => void) | undefined
        let started: (() => void) | undefined
        const pending = new Promise<{ retry: readonly string[] }>((resolve) => {
            finish = resolve
        })
        const stalled = new Promise<void>((resolve) => {
            release = resolve
        })
        const replacementStarted = new Promise<void>((resolve) => {
            started = resolve
        })
        const delivered: string[] = []
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
        const first = lane.install({
            batchSize: 2,
            async deliver() {
                return pending
            },
        })
        await Promise.resolve()
        const flush = lane.flush()
        first.dispose()
        lane.install({
            async deliver(events) {
                delivered.push(...events)
                started?.()
                await stalled
            },
        })
        let flushed = false
        void flush.then(() => {
            flushed = true
        })

        now = 101
        finish?.({ retry: ['expired', 'retained'] })
        await replacementStarted

        expect(delivered).toEqual(['retained'])
        expect(flushed).toBe(false)
        release?.()
        await flush
        expect(flushed).toBe(true)
    })

    it('does not revive a retained retry when expiry reporting purges the lane', async () => {
        let now = 0
        let finish: ((result: { retry: readonly string[] }) => void) | undefined
        const pending = new Promise<{ retry: readonly string[] }>((resolve) => {
            finish = resolve
        })
        const delivered: string[] = []
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
        const first = lane.install({
            batchSize: 2,
            async deliver() {
                return pending
            },
        })
        await Promise.resolve()
        first.dispose()
        lane.install({
            async deliver(events) {
                delivered.push(...events)
            },
        })

        now = 101
        finish?.({ retry: ['expired', 'retained'] })
        await Promise.resolve()
        await lane.flush()

        expect(delivered).toEqual([])
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
            let finish: ((value: unknown) => void) | undefined
            const pending = new Promise<unknown>((resolve) => {
                finish = resolve
            })
            const lane = new Lane<string>(
                2,
                (error) => errors.push(error),
                () => {},
                10
            )
            const first = lane.install({
                async deliver() {
                    return pending as Promise<{ retry: readonly string[] }>
                },
            })
            lane.enqueue('retry', 5)
            await Promise.resolve()
            first.dispose()
            lane.install({ async deliver() {} })
            finish?.(result)

            await expect(lane.flush()).resolves.toBeUndefined()
            expect((lane as unknown as { _activeBytes: number })._activeBytes).toBe(0)
            await expect(lane.dispose()).resolves.toBeUndefined()
        }
        expect(errors).toHaveLength(2)
    })

    it('preserves retry multiplicity when active entries share the same value', async () => {
        let finish: ((result: { retry: readonly string[] }) => void) | undefined
        const pending = new Promise<{ retry: readonly string[] }>((resolve) => {
            finish = resolve
        })
        const delivered: string[] = []
        const lane = createLane<string>(3)
        lane.enqueue('same')
        lane.enqueue('same')
        const first = lane.install({
            batchSize: 2,
            async deliver() {
                return pending
            },
        })
        await Promise.resolve()
        const flush = lane.flush()
        first.dispose()
        lane.install({
            async deliver(events) {
                delivered.push(...events)
            },
        })

        finish?.({ retry: ['same'] })
        await flush

        expect(delivered).toEqual(['same'])
    })

    it('resolves a detached flush after retry handoff when no replacement is installed', async () => {
        let finish: ((result: { retry: readonly string[] }) => void) | undefined
        const pending = new Promise<{ retry: readonly string[] }>((resolve) => {
            finish = resolve
        })
        const lane = createLane<string>()
        const installation = lane.install({
            async deliver() {
                return pending
            },
        })
        lane.enqueue('retry')
        await Promise.resolve()
        const flush = lane.flush()
        let flushed = false
        void flush.then(() => {
            flushed = true
        })

        installation.dispose()
        await Promise.resolve()
        expect(flushed).toBe(false)
        finish?.({ retry: ['retry'] })
        await expect(flush).resolves.toBeUndefined()

        const delivered: string[] = []
        lane.install({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        await lane.flush()
        expect(delivered).toEqual(['retry'])
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
        lane.install({
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
        lane.install({
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
        lane.install({
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
        lane.install(delivery)

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
        lane.install({
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
        lane.install({
            async deliver(events) {
                delivered.push(...events)
            },
        })
        await lane.dispose()
        lane.enqueue('disposed')
        await lane.flush()

        expect(delivered).toEqual([])
    })
})
