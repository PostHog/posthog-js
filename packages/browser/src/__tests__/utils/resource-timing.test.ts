import { RESOURCE_ENTRY_WAIT_MS, type ResourceTimingWatch, watchResourceTiming } from '../../utils/resource-timing'
import { FakePerformanceObserver, resourceEntry } from '../helpers/fake-performance-observer'

const URL_A = 'https://flags.example.com/flags/?v=2'

describe('watchResourceTiming', () => {
    let clock: number
    let started: ResourceTimingWatch[]

    // Live watches are shared across calls, so each test stops the watches it started.
    const startWatch = (url: string) => {
        const watch = watchResourceTiming(url)
        if (watch) {
            started.push(watch)
        }
        return watch
    }

    beforeEach(() => {
        FakePerformanceObserver.reset()
        vi.stubGlobal('PerformanceObserver', FakePerformanceObserver)
        clock = 100
        started = []
        vi.spyOn(performance, 'now').mockImplementation(() => clock)
    })

    afterEach(() => {
        for (const watch of started) {
            watch.stop()
        }
        vi.useRealTimers()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('returns undefined when the browser has no PerformanceObserver', () => {
        vi.stubGlobal('PerformanceObserver', undefined)

        expect(startWatch(URL_A)).toBeUndefined()
    })

    it('returns undefined when observing resource entries throws', () => {
        vi.spyOn(FakePerformanceObserver.prototype, 'observe').mockImplementation(() => {
            throw new TypeError('unsupported')
        })

        expect(startWatch(URL_A)).toBeUndefined()
    })

    it('observes resource entries without the buffered entries', () => {
        startWatch(URL_A)

        expect(FakePerformanceObserver.latest.observed).toEqual({ entryTypes: ['resource'] })
    })

    it('hands over an entry the browser recorded but has not delivered yet, then disconnects', () => {
        const watch = startWatch(URL_A)!
        const onEntry = vi.fn()
        FakePerformanceObserver.latest.queue(resourceEntry(URL_A, 101, 250))

        watch.take(1000, onEntry)

        expect(onEntry).toHaveBeenCalledWith(expect.objectContaining({ startTime: 101, responseEnd: 250 }))
        expect(FakePerformanceObserver.latest.disconnected).toBe(true)
    })

    it('hands over an entry delivered before take', () => {
        const watch = startWatch(URL_A)!
        const onEntry = vi.fn()
        FakePerformanceObserver.latest.deliver(resourceEntry(URL_A, 101, 250))

        watch.take(1000, onEntry)

        expect(onEntry).toHaveBeenCalledTimes(1)
    })

    it('waits for an entry that arrives after take', () => {
        const watch = startWatch(URL_A)!
        const onEntry = vi.fn()

        watch.take(1000, onEntry)
        expect(onEntry).not.toHaveBeenCalled()
        expect(FakePerformanceObserver.latest.disconnected).toBe(false)

        FakePerformanceObserver.latest.deliver(resourceEntry(URL_A, 101, 250))

        expect(onEntry).toHaveBeenCalledTimes(1)
        expect(FakePerformanceObserver.latest.disconnected).toBe(true)
    })

    it('resolves a relative URL against the page, as entry names are absolute', () => {
        const watch = startWatch('/ingest/flags/?v=2')!
        const onEntry = vi.fn()
        FakePerformanceObserver.latest.queue(resourceEntry(`${window.location.origin}/ingest/flags/?v=2`, 101, 250))

        watch.take(1000, onEntry)

        expect(onEntry).toHaveBeenCalledTimes(1)
    })

    it('ignores entries for other URLs and entries that started before the watch', () => {
        const watch = startWatch(URL_A)!
        const onEntry = vi.fn()
        FakePerformanceObserver.latest.queue(
            resourceEntry('https://flags.example.com/flags/?v=2&compression=base64', 101, 250),
            resourceEntry(URL_A, 99, 250)
        )

        watch.take(1000, onEntry)

        expect(onEntry).not.toHaveBeenCalled()
    })

    it('picks the entry that started first at or after the watch', () => {
        const watch = startWatch(URL_A)!
        const onEntry = vi.fn()
        FakePerformanceObserver.latest.queue(
            resourceEntry(URL_A, 140, 300),
            resourceEntry(URL_A, 100, 250),
            resourceEntry(URL_A, 120, 260)
        )

        watch.take(1000, onEntry)

        expect(onEntry).toHaveBeenCalledWith(expect.objectContaining({ startTime: 100 }))
    })

    it('ignores an entry that started after the request ended', () => {
        const watch = startWatch(URL_A)!
        const onEntry = vi.fn()
        FakePerformanceObserver.latest.queue(resourceEntry(URL_A, 301, 400))

        watch.take(300, onEntry)

        expect(onEntry).not.toHaveBeenCalled()
    })

    it('leaves the entry of a later request to the same URL to that request', () => {
        const first = startWatch(URL_A)!
        const firstObserver = FakePerformanceObserver.latest
        clock = 150
        const second = startWatch(URL_A)!
        const secondObserver = FakePerformanceObserver.latest
        const onFirst = vi.fn()
        const onSecond = vi.fn()

        const secondEntry = resourceEntry(URL_A, 151, 200)
        firstObserver.deliver(secondEntry)
        secondObserver.deliver(secondEntry)
        second.take(210, onSecond)
        first.take(300, onFirst)

        expect(onSecond).toHaveBeenCalledWith(expect.objectContaining({ startTime: 151 }))
        expect(onFirst).not.toHaveBeenCalled()

        const firstEntry = resourceEntry(URL_A, 101, 280)
        firstObserver.deliver(firstEntry)

        expect(onFirst).toHaveBeenCalledWith(expect.objectContaining({ startTime: 101 }))
    })

    it('refuses an entry that ties the start of a later watch, as either request could own it', () => {
        const first = startWatch(URL_A)!
        const firstObserver = FakePerformanceObserver.latest
        clock = 150
        const second = startWatch(URL_A)!
        const secondObserver = FakePerformanceObserver.latest
        const onFirst = vi.fn()
        const onSecond = vi.fn()

        firstObserver.queue(resourceEntry(URL_A, 150, 200))
        secondObserver.queue(resourceEntry(URL_A, 150, 200))
        first.take(300, onFirst)
        second.take(300, onSecond)

        expect(onFirst).not.toHaveBeenCalled()
        expect(onSecond).not.toHaveBeenCalled()
    })

    it('accepts an entry that ties its own start when no other watch for the URL is live', () => {
        const first = startWatch(URL_A)!
        first.stop()
        clock = 150
        const second = startWatch(URL_A)!
        const onSecond = vi.fn()
        FakePerformanceObserver.latest.queue(resourceEntry(URL_A, 150, 200))

        second.take(300, onSecond)

        expect(onSecond).toHaveBeenCalledTimes(1)
    })

    it('accepts an entry that ties its own start when the earlier request has ended but awaits its entry', () => {
        const first = startWatch(URL_A)!
        const firstObserver = FakePerformanceObserver.latest
        const onFirst = vi.fn()
        first.take(200, onFirst)
        clock = 200
        const second = startWatch(URL_A)!
        const secondObserver = FakePerformanceObserver.latest
        const onSecond = vi.fn()

        secondObserver.queue(resourceEntry(URL_A, 200, 260))
        second.take(270, onSecond)
        firstObserver.deliver(resourceEntry(URL_A, 101, 190))

        expect(onSecond).toHaveBeenCalledWith(expect.objectContaining({ startTime: 200 }))
        expect(onFirst).toHaveBeenCalledWith(expect.objectContaining({ startTime: 101 }))
    })

    it('disconnects without an entry when none arrives within the wait', () => {
        vi.useFakeTimers()
        const watch = startWatch(URL_A)!
        const onEntry = vi.fn()

        watch.take(1000, onEntry)
        vi.advanceTimersByTime(RESOURCE_ENTRY_WAIT_MS)
        FakePerformanceObserver.latest.deliver(resourceEntry(URL_A, 101, 250))

        expect(onEntry).not.toHaveBeenCalled()
        expect(FakePerformanceObserver.latest.disconnected).toBe(true)
    })

    it('stop disconnects and drops later entries', () => {
        const watch = startWatch(URL_A)!
        const onEntry = vi.fn()

        watch.stop()
        watch.take(1000, onEntry)
        FakePerformanceObserver.latest.deliver(resourceEntry(URL_A, 101, 250))

        expect(onEntry).not.toHaveBeenCalled()
        expect(FakePerformanceObserver.latest.disconnected).toBe(true)
    })
})
