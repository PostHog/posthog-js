import { CaptureMetrics } from '../capture-metrics'
import { RetryQueue } from '../retry-queue'

const EPOCH = 1_600_000_000
const defaultRequestOptions = {
    method: 'POST',
    transport: 'XHR',
}

describe('RetryQueue', () => {
    given('retryQueue', () => new RetryQueue(given.captureMetrics))
    given('captureMetrics', () => new CaptureMetrics(true, jest.fn(), jest.fn()))

    const xhrMockClass = () => ({
        open: jest.fn(),
        send: jest.fn(),
        setRequestHeader: jest.fn(),
        status: 418,
    })

    window.XMLHttpRequest = jest.fn().mockImplementation(xhrMockClass)
    window.navigator.sendBeacon = jest.fn()

    function fastForwardTimeAndRunTimer() {
        jest.spyOn(global.Date, 'now').mockImplementationOnce(() => new Date().getTime() + 3500)

        jest.runOnlyPendingTimers()
    }

    function enqueueRequests() {
        given.retryQueue.enqueue({
            url: '/e',
            data: { event: 'foo', timestamp: EPOCH - 3000 },
            options: defaultRequestOptions,
        })
        given.retryQueue.enqueue({
            url: '/e',
            data: { event: 'bar', timestamp: EPOCH - 2000 },
            options: defaultRequestOptions,
        })
        given.retryQueue.enqueue({
            url: '/e',
            data: { event: 'baz', timestamp: EPOCH - 1000 },
            options: defaultRequestOptions,
        })
        given.retryQueue.enqueue({
            url: '/e',
            data: { event: 'fizz', timestamp: EPOCH },
            options: defaultRequestOptions,
        })
    }

    beforeEach(() => {
        jest.useFakeTimers()
        jest.spyOn(given.retryQueue, 'getTime').mockReturnValue(EPOCH)
    })

    it('processes retry requests', () => {
        enqueueRequests()

        expect(given.retryQueue.queue.length).toEqual(4)

        expect(given.retryQueue.queue).toEqual([
            {
                requestData: {
                    url: '/e',
                    data: { event: 'foo', timestamp: EPOCH - 3000 },
                    options: defaultRequestOptions,
                },
                retryAt: expect.any(Date),
            },
            {
                requestData: {
                    url: '/e',
                    data: { event: 'bar', timestamp: EPOCH - 2000 },
                    options: defaultRequestOptions,
                },
                retryAt: expect.any(Date),
            },
            {
                requestData: {
                    url: '/e',
                    data: { event: 'baz', timestamp: EPOCH - 1000 },
                    options: defaultRequestOptions,
                },
                retryAt: expect.any(Date),
            },
            {
                requestData: {
                    url: '/e',
                    data: { event: 'fizz', timestamp: EPOCH },
                    options: defaultRequestOptions,
                },
                retryAt: expect.any(Date),
            },
        ])

        expect(window.XMLHttpRequest).toHaveBeenCalledTimes(0)

        fastForwardTimeAndRunTimer()

        // clears queue
        expect(given.retryQueue.queue.length).toEqual(0)

        expect(window.XMLHttpRequest).toHaveBeenCalledTimes(4)
    })

    it('tries to send requests via beacon on unload', () => {
        enqueueRequests()

        given.retryQueue.poll()
        given.retryQueue.unload()

        expect(given.retryQueue.queue.length).toEqual(0)
        expect(window.navigator.sendBeacon).toHaveBeenCalledTimes(4)
    })

    it('enqueues requests when offline and flushes immediately when online again', () => {
        given.retryQueue.areWeOnline = false
        expect(given.retryQueue.areWeOnline).toEqual(false)

        enqueueRequests()

        fastForwardTimeAndRunTimer()

        // requests aren't attempted when we're offline
        expect(window.XMLHttpRequest).toHaveBeenCalledTimes(0)

        // queue stays the same
        expect(given.retryQueue.queue.length).toEqual(4)

        given.retryQueue._handleWeAreNowOnline()

        expect(given.retryQueue.areWeOnline).toEqual(true)
        expect(given.retryQueue.queue.length).toEqual(0)

        expect(window.XMLHttpRequest).toHaveBeenCalledTimes(4)
    })

    it('retries using an exponential backoff mechanism', () => {
        const fixedDate = new Date('2021-05-31T00:00:00')
        jest.spyOn(global.Date, 'now').mockImplementation(() => fixedDate.getTime())

        given.retryQueue.enqueue({
            url: '/e',
            data: { event: '1retry', timestamp: EPOCH },
            options: defaultRequestOptions,
            retriesPerformedSoFar: 1,
        })

        given.retryQueue.enqueue({
            url: '/e',
            data: { event: '5retries', timestamp: EPOCH },
            options: defaultRequestOptions,
            retriesPerformedSoFar: 5,
        })

        given.retryQueue.enqueue({
            url: '/e',
            data: { event: '9retries', timestamp: EPOCH },
            options: defaultRequestOptions,
            retriesPerformedSoFar: 9,
        })

        expect(given.retryQueue.queue).toEqual([
            {
                requestData: {
                    url: '/e',
                    data: { event: '1retry', timestamp: EPOCH },
                    options: defaultRequestOptions,
                    retriesPerformedSoFar: 1,
                },
                retryAt: new Date(fixedDate.getTime() + 6000), // 3000 * 2^1
            },
            {
                requestData: {
                    url: '/e',
                    data: { event: '5retries', timestamp: EPOCH },
                    options: defaultRequestOptions,
                    retriesPerformedSoFar: 5,
                },
                retryAt: new Date(fixedDate.getTime() + 96000), // 3000 * 2^5
            },
            {
                requestData: {
                    url: '/e',
                    data: { event: '9retries', timestamp: EPOCH },
                    options: defaultRequestOptions,
                    retriesPerformedSoFar: 9,
                },
                retryAt: new Date(fixedDate.getTime() + 1536000), // 3000 * 2^9
            },
        ])
    })

    it('retries using an exponential backoff mechanism', () => {
        given.retryQueue.enqueue({
            url: '/e',
            data: { event: 'maxretries', timestamp: EPOCH },
            options: defaultRequestOptions,
            retriesPerformedSoFar: 10,
        })

        expect(given.retryQueue.queue.length).toEqual(0)
    })
})
