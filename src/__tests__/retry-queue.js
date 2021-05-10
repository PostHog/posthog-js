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

        expect(given.queue._event_queue.length).toEqual(4)
        expect(given.queue._requestRetriesMap).toEqual(
            new Map([
                [1, 0],
                [2, 0],
                [3, 0],
                [4, 0],
            ])
        )

        given.queue.poll()

        expect(window.XMLHttpRequest).toHaveBeenCalledTimes(0)

        jest.runOnlyPendingTimers()

        expect(window.XMLHttpRequest).toHaveBeenCalledTimes(4)

        expect(given.queue._event_queue.length).toEqual(0)

        enqueueRequests()

        expect(given.queue._event_queue.length).toEqual(4)
        expect(given.queue._requestRetriesMap).toEqual(
            new Map([
                [1, 1],
                [2, 1],
                [3, 1],
                [4, 1],
            ])
        )
        expect(given.queue._event_queue).toEqual([
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

    it('clears polling flag after 4 empty iterations', () => {
        enqueueRequests()

        for (let i = 0; i < 5; i++) {
            given.queue.poll()
            jest.runOnlyPendingTimers()

            expect(given.queue.isPolling).toEqual(true)
        }

        given.queue.poll()
        jest.runOnlyPendingTimers()

        expect(given.queue.isPolling).toEqual(false)
    })

    it('stops retrying after 3 attempts', () => {
        given.queue.poll()

        // Add requests to queue and retry twice
        for (let i = 0; i < 2; ++i) {
            enqueueRequests()
            expect(given.queue._event_queue.length).toEqual(4)
            jest.runOnlyPendingTimers()
        }

        // Enqueue requests a third time
        enqueueRequests()

        expect(given.queue._event_queue.length).toEqual(4)
        expect(given.queue._requestRetriesMap).toEqual(
            new Map([
                [1, 2],
                [2, 2],
                [3, 2],
                [4, 2],
            ])
        )

        // Retry a third time
        jest.runOnlyPendingTimers()

        // Try to enqueue the same requests again
        enqueueRequests()

        // Requests are not added to the queue
        expect(given.queue._event_queue.length).toEqual(0)

        // Requests are cleared from retries map
        expect(given.queue._requestRetriesMap).toEqual(new Map())
    })
})
