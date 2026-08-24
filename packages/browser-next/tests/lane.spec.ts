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

    it('drops an older retry when detachment requeue would exceed capacity', async () => {
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
