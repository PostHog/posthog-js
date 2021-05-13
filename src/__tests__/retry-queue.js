import { CaptureMetrics } from '../capture-metrics'
import { RetryQueue } from '../retry-queue'

const EPOCH = 1_600_000_000
const defaultRequestOptions = {
    method: 'POST',
    transport: 'XHR',
}

describe('RetryQueue', () => {
    given('queue', () => new RetryQueue(given.captureMetrics))
    given('captureMetrics', () => new CaptureMetrics(true, jest.fn(), jest.fn()))

    window.addEventListener = jest.fn().mockImplementationOnce((event, callback) => {
        callback()
    })

    const xhrMockClass = () => ({
        open: jest.fn(),
        send: jest.fn(),
        setRequestHeader: jest.fn(),
        status: 418,
    })

    window.XMLHttpRequest = jest.fn().mockImplementation(xhrMockClass)
    window.navigator.sendBeacon = jest.fn()

    function enqueueRequests() {
        given.queue.enqueue({
            url: '/e',
            data: { event: 'foo', timestamp: EPOCH - 3000 },
            options: defaultRequestOptions,
            requestId: 1,
        })
        given.queue.enqueue({
            url: '/e',
            data: { event: 'bar', timestamp: EPOCH - 2000 },
            options: defaultRequestOptions,
            requestId: 2,
        })
        given.queue.enqueue({
            url: '/e',
            data: { event: 'baz', timestamp: EPOCH - 1000 },
            options: defaultRequestOptions,
            requestId: 3,
        })
        given.queue.enqueue({
            url: '/e',
            data: { event: 'fizz', timestamp: EPOCH },
            options: defaultRequestOptions,
            requestId: 4,
        })
    }

    beforeEach(() => {
        jest.useFakeTimers()
        jest.spyOn(given.queue, 'getTime').mockReturnValue(EPOCH)
    })

    it('processes retry requests', () => {
        enqueueRequests()

        expect(given.queue._counterToQueueMap[1].length).toEqual(4)
        expect(given.queue._requestRetriesMap).toEqual({
            1: 0,
            2: 0,
            3: 0,
            4: 0,
        })

        given.queue.poll()

        expect(window.XMLHttpRequest).toHaveBeenCalledTimes(0)

        jest.runOnlyPendingTimers()

        expect(window.XMLHttpRequest).toHaveBeenCalledTimes(4)

        expect(given.queue._counterToQueueMap[1]).toEqual(undefined)

        enqueueRequests()

        expect(given.queue._counterToQueueMap[2].length).toEqual(4)
        expect(given.queue._requestRetriesMap).toEqual({
            1: 1,
            2: 1,
            3: 1,
            4: 1,
        })

        expect(given.queue._counterToQueueMap[2]).toEqual([
            {
                url: '/e',
                data: { event: 'foo', timestamp: EPOCH - 3000 },
                options: defaultRequestOptions,
                requestId: 1,
            },
            {
                url: '/e',
                data: { event: 'bar', timestamp: EPOCH - 2000 },
                options: defaultRequestOptions,
                requestId: 2,
            },
            {
                url: '/e',
                data: { event: 'baz', timestamp: EPOCH - 1000 },
                options: defaultRequestOptions,
                requestId: 3,
            },
            {
                url: '/e',
                data: { event: 'fizz', timestamp: EPOCH },
                options: defaultRequestOptions,
                requestId: 4,
            },
        ])
    })

    it('tries to send requests via beacon on unload ', () => {
        enqueueRequests()

        given.queue.poll()
        given.queue.unload()

        expect(given.queue._event_queue.length).toEqual(0)
        expect(window.navigator.sendBeacon).toHaveBeenCalledTimes(4)
    })

    it('enqueues requests when offline and flushes immediately when online again', () => {
        enqueueRequests()

        given.queue._areWeOnline = false
        expect(given.queue._areWeOnline).toEqual(false)

        given.queue.poll()
        jest.runOnlyPendingTimers()

        expect(window.XMLHttpRequest).toHaveBeenCalledTimes(4)
        expect(given.queue._offlineBacklog.length).toEqual(4)

        given.queue._handleWeAreNowOnline()

        expect(given.queue._areWeOnline).toEqual(true)
        expect(given.queue._offlineBacklog.length).toEqual(0)

        expect(window.XMLHttpRequest).toHaveBeenCalledTimes(8)
    })

    it('retries using an exponential backoff mechanism', () => {
        enqueueRequests()

        expect(given.queue._counterToQueueMap[1].length).toEqual(4)
        expect(given.queue._requestRetriesMap).toEqual({
            1: 0,
            2: 0,
            3: 0,
            4: 0,
        })

        jest.runOnlyPendingTimers()
        enqueueRequests()

        expect(given.queue._counterToQueueMap[1]).toEqual(undefined)
        expect(given.queue._counterToQueueMap[2].length).toEqual(4)
        expect(given.queue._requestRetriesMap).toEqual({
            1: 1,
            2: 1,
            3: 1,
            4: 1,
        })

        jest.runOnlyPendingTimers()
        enqueueRequests()

        expect(given.queue._counterToQueueMap[2]).toEqual(undefined)
        expect(given.queue._counterToQueueMap[4].length).toEqual(4)
        expect(given.queue._requestRetriesMap).toEqual({
            1: 2,
            2: 2,
            3: 2,
            4: 2,
        })

        for (let i = 0; i < 2; ++i) {
            jest.runOnlyPendingTimers()
        }

        enqueueRequests()

        expect(given.queue._counterToQueueMap[4]).toEqual(undefined)
        expect(given.queue._counterToQueueMap[8].length).toEqual(4)
        expect(given.queue._requestRetriesMap).toEqual({
            1: 3,
            2: 3,
            3: 3,
            4: 3,
        })
    })
})
