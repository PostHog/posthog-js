import { CaptureMetrics } from '../capture-metrics'
import { RetryQueue } from '../retry-queue'
import * as SendRequest from '../send-request'

const EPOCH = 1_600_000_000
const defaultRequestOptions = {
    method: 'POST',
    transport: 'XHR',
}

describe('RetryQueue', () => {
    given('retryQueue', () => new RetryQueue(given.captureMetrics, given.onXHRError))
    given('captureMetrics', () => new CaptureMetrics(true, jest.fn(), jest.fn()))
    given('onXHRError', () => jest.fn().mockImplementation(console.error))

    const xhrMockClass = () => ({
        open: jest.fn(),
        send: jest.fn(),
        setRequestHeader: jest.fn(),
        status: 418,
    })

    window.XMLHttpRequest = jest.fn().mockImplementation(xhrMockClass)
    window.navigator.sendBeacon = jest.fn()

    beforeEach(() => {
        jest.useFakeTimers()
        jest.spyOn(given.retryQueue, 'getTime').mockReturnValue(EPOCH)
    })

    const fastForwardTimeAndRunTimer = () => {
        jest.spyOn(global.Date, 'now').mockImplementationOnce(() => new Date().getTime() + 3500)
        jest.runOnlyPendingTimers()
    }

    const enqueueRequests = () => {
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
        expect(given.onXHRError).toHaveBeenCalledTimes(0)
    })

    it('tries to send requests via beacon on unload', () => {
        enqueueRequests()

        given.retryQueue.poll()
        given.retryQueue.unload()

        expect(given.retryQueue.queue.length).toEqual(0)
        expect(window.navigator.sendBeacon).toHaveBeenCalledTimes(4)
    })

    it('when you flush the queue onXHRError is passed to xhr', () => {
        const xhrSpy = jest.spyOn(SendRequest, 'xhr')
        enqueueRequests()
        given.retryQueue.flush()
        fastForwardTimeAndRunTimer()
        expect(xhrSpy).toHaveBeenCalledWith(expect.objectContaining({ onXHRError: given.onXHRError }))
    })

    it('enqueues requests when offline and flushes immediately when online again', () => {
        given.retryQueue.areWeOnline = false
        expect(given.retryQueue.areWeOnline).toEqual(false)

        enqueueRequests()

        fastForwardTimeAndRunTimer()

        // requests aren't attempted when we're offline
        expect(window.XMLHttpRequest).toHaveBeenCalledTimes(0)
        // doesn't log that it is offline from the retry queue
        expect(given.onXHRError).toHaveBeenCalledTimes(0)

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

    it('does not enqueue a request after 10 retries', () => {
        given.retryQueue.enqueue({
            url: '/e',
            data: { event: 'maxretries', timestamp: EPOCH },
            options: defaultRequestOptions,
            retriesPerformedSoFar: 10,
        })

        expect(given.retryQueue.queue.length).toEqual(0)
    })
})
