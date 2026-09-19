import { pickNextRetryDelay, RetryQueue } from '../retry-queue'
import { assignableWindow } from '../utils/globals'
import type { TransportCallback } from '../request'
import type { PostHog } from '../posthog-core'
import type { RequestWithOptions } from '../types'

const mockTransport = vi.hoisted(() => vi.fn())
vi.mock('../request-dispatch', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../request-dispatch')>()),
    sendRequest: (_instance: PostHog, options: RequestWithOptions, callback: TransportCallback) =>
        mockTransport({ ...options, callback }),
}))

describe('RetryQueue', () => {
    const mockPosthog = {
        _send_request: mockTransport,
    }
    let retryQueue: RetryQueue
    let now = Date.now()

    beforeEach(() => {
        retryQueue = new RetryQueue(mockPosthog as any)

        vi.useFakeTimers()
        vi.setSystemTime(now)
        assignableWindow.POSTHOG_DEBUG = false
        vi.spyOn(assignableWindow.console, 'warn').mockImplementation(() => {})
    })

    const fastForwardTimeAndRunTimer = (time = 3500) => {
        now += time
        vi.setSystemTime(now)
        vi.runOnlyPendingTimers()
    }

    const enqueueRequests = () => {
        mockTransport.mockImplementation(({ callback }) => {
            // Force a retry
            callback?.({ statusCode: 502 })
        })

        retryQueue.retriableRequest({
            url: '/e',
            data: { event: 'foo', timestamp: now - 3000 },
        })
        retryQueue.retriableRequest({
            url: '/e',
            data: { event: 'bar', timestamp: now - 2000 },
        })
        retryQueue.retriableRequest({
            url: '/e',
            data: { event: 'baz', timestamp: now - 1000 },
        })
        retryQueue.retriableRequest({
            url: '/e',
            data: { event: 'fizz', timestamp: now },
        })

        mockTransport.mockImplementation(({ callback }) => {
            callback?.({ statusCode: 200 })
        })

        expect(mockTransport).toHaveBeenCalledTimes(4)
        mockTransport.mockClear()
    }

    it('processes retry requests', () => {
        enqueueRequests()

        expect(retryQueue.length).toEqual(4)
        expect(retryQueue['_queue']).toEqual([
            {
                requestOptions: {
                    url: '/e',
                    data: { event: 'foo', timestamp: now - 3000 },
                    retriesPerformedSoFar: 1,
                },
                retryAt: expect.any(Number),
            },
            {
                requestOptions: {
                    url: '/e',
                    data: { event: 'bar', timestamp: now - 2000 },
                    retriesPerformedSoFar: 1,
                },
                retryAt: expect.any(Number),
            },
            {
                requestOptions: {
                    url: '/e',
                    data: { event: 'baz', timestamp: now - 1000 },
                    retriesPerformedSoFar: 1,
                },
                retryAt: expect.any(Number),
            },
            {
                requestOptions: {
                    url: '/e',
                    data: { event: 'fizz', timestamp: now },
                    retriesPerformedSoFar: 1,
                },
                retryAt: expect.any(Number),
            },
        ])

        // Fast forward enough time to clear the jitter
        fastForwardTimeAndRunTimer(3500)

        // clears queue
        expect(retryQueue.length).toEqual(0)
        expect(mockTransport).toHaveBeenCalledTimes(4)
        // Check the retry count is added
        expect(mockTransport.mock.calls.map(([arg1]) => arg1.url)).toEqual([
            '/e?retry_count=1',
            '/e?retry_count=1',
            '/e?retry_count=1',
            '/e?retry_count=1',
        ])
    })

    it.each([undefined, 'fetch', 'XHR'] as const)('restores transport %s after a one-attempt override', (transport) => {
        const callback = vi.fn()
        const data = { event: 'conversion', uuid: 'event-id' }
        mockTransport.mockImplementation(({ callback }) => callback({ statusCode: 503 }))

        retryQueue.retriableRequest({ url: '/e', data, transport, callback }, 'sendBeacon')

        expect(mockTransport).toHaveBeenLastCalledWith(expect.objectContaining({ transport: 'sendBeacon', data }))
        expect(retryQueue.length).toBe(1)
        expect(retryQueue['_queue'][0].requestOptions.transport).toBe(transport)
        expect(callback).not.toHaveBeenCalled()

        mockTransport.mockImplementation(({ callback }) => callback({ statusCode: 200 }))
        fastForwardTimeAndRunTimer()

        expect(mockTransport).toHaveBeenLastCalledWith(
            expect.objectContaining({ transport, data, url: '/e?retry_count=1' })
        )
        expect(retryQueue.length).toBe(0)
        expect(callback).toHaveBeenCalledOnce()
        expect(callback).toHaveBeenCalledWith({ statusCode: 200 })
    })

    it('adds the retry_count to the url', () => {
        enqueueRequests()
        fastForwardTimeAndRunTimer(3500)

        expect(mockTransport.mock.calls.map(([arg1]) => arg1.url)).toEqual([
            '/e?retry_count=1',
            '/e?retry_count=1',
            '/e?retry_count=1',
            '/e?retry_count=1',
        ])
    })

    it('tries to send requests via beacon on unload', () => {
        enqueueRequests()

        retryQueue.unload()

        expect(retryQueue.length).toEqual(0)
        expect(mockTransport).toHaveBeenCalledTimes(4)
        expect(mockTransport.mock.calls.map(([arg1]) => arg1.transport)).toEqual([
            'sendBeacon',
            'sendBeacon',
            'sendBeacon',
            'sendBeacon',
        ])
    })

    it('enqueues requests when offline and flushes immediately when online again', () => {
        retryQueue['_areWeOnline'] = false
        expect(retryQueue['_areWeOnline']).toEqual(false)

        enqueueRequests()
        fastForwardTimeAndRunTimer()

        // requests aren't attempted when we're offline
        expect(mockTransport).toHaveBeenCalledTimes(0)

        // queue stays the same
        expect(retryQueue.length).toEqual(4)

        window.dispatchEvent(new Event('online'))

        expect(retryQueue['_areWeOnline']).toEqual(true)
        expect(retryQueue.length).toEqual(0)
        expect(mockTransport).toHaveBeenCalledTimes(4)
    })

    it('keeps the queue retriable when the realm has no timers', () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout')!
        Object.defineProperty(globalThis, 'setTimeout', { value: undefined, configurable: true, writable: true })

        try {
            expect(() => enqueueRequests()).not.toThrow()

            // No poller exists, so the queue must not claim it is polling
            expect(retryQueue['_isPolling']).toBe(false)
            expect(retryQueue['_poller']).toBeUndefined()
            expect(retryQueue.length).toEqual(4)
        } finally {
            Object.defineProperty(globalThis, 'setTimeout', descriptor)
        }

        // Timers are back, so the next failed request starts polling again
        mockTransport.mockImplementation(({ callback }) => callback?.({ statusCode: 502 }))
        retryQueue.retriableRequest({ url: '/e', data: { event: 'later', timestamp: now } })

        expect(retryQueue['_isPolling']).toBe(true)
        expect(retryQueue['_poller']).toBeDefined()
    })

    it('does not enqueue a request after 10 retries', () => {
        retryQueue.retriableRequest({
            url: '/e',
            data: { event: 'maxretries', timestamp: now },
            retriesPerformedSoFar: 10,
        })

        expect(retryQueue.length).toEqual(0)
    })

    it.each([
        { retriesPerformedSoFar: 2, expectedQueueLength: 1, expectedNextRetries: 3 },
        { retriesPerformedSoFar: 3, expectedQueueLength: 0, expectedLogRetries: 3 },
        { retriesPerformedSoFar: 5, expectedQueueLength: 0, expectedLogRetries: 5 },
    ])('handles statusCode 0 requests after $retriesPerformedSoFar retries', (testCase) => {
        assignableWindow.POSTHOG_DEBUG = !!testCase.expectedLogRetries
        const cb = vi.fn()
        mockTransport.mockImplementation(({ callback }) => {
            callback?.({ statusCode: 0 })
        })

        retryQueue.retriableRequest({
            url: '/e',
            data: { event: 'status-0-retry', timestamp: now },
            callback: cb,
            retriesPerformedSoFar: testCase.retriesPerformedSoFar,
        })

        expect(retryQueue.length).toEqual(testCase.expectedQueueLength)

        if (testCase.expectedNextRetries) {
            expect(retryQueue['_queue'][0].requestOptions.retriesPerformedSoFar).toEqual(testCase.expectedNextRetries)
            expect(cb).not.toHaveBeenCalled()
            expect(assignableWindow.console.warn).not.toHaveBeenCalled()
        } else {
            expect(cb).toHaveBeenCalledWith({ statusCode: 0 })
            expect(assignableWindow.console.warn).toHaveBeenCalledWith(
                '[PostHog.js]',
                `Request failed before receiving an HTTP response; this can happen due to network issues, CORS, browser blocking, or ad blockers. Stopped retrying after ${testCase.expectedLogRetries} retries.`
            )
        }
    })

    it('only calls the callback when successful', () => {
        const cb = vi.fn()
        mockTransport.mockImplementation(({ callback }) => {
            callback?.({ statusCode: 500 })
        })

        retryQueue.retriableRequest({
            url: '/e',
            data: { event: 'maxretries', timestamp: now },
            callback: cb,
        })

        mockTransport.mockImplementation(({ callback }) => {
            callback?.({ statusCode: 200, text: 'it worked!' })
        })

        fastForwardTimeAndRunTimer()

        expect(retryQueue.length).toEqual(0)
        expect(cb).toHaveBeenCalledTimes(1)
        expect(cb).toHaveBeenCalledWith({ statusCode: 200, text: 'it worked!' })
    })

    it('only calls the callback when retries are exhausted', () => {
        const cb = vi.fn()
        mockTransport.mockImplementation(({ callback }) => {
            callback?.({ statusCode: 500 })
        })

        retryQueue.retriableRequest({
            url: '/e',
            data: { event: 'maxretries', timestamp: now },
            callback: cb,
            retriesPerformedSoFar: 10,
        })

        expect(retryQueue.length).toEqual(0)
        expect(cb).toHaveBeenCalledTimes(1)
        expect(cb).toHaveBeenCalledWith({ statusCode: 500 })
    })

    it('increments the retry count each attempt', () => {
        const cb = vi.fn()
        mockTransport.mockImplementation(({ callback }) => {
            callback?.({ statusCode: 500 })
        })

        retryQueue.retriableRequest({
            url: '/e',
            data: { event: 'maxretries', timestamp: now },
            callback: cb,
            retriesPerformedSoFar: 1,
        })

        expect(retryQueue.length).toEqual(1)
        expect(retryQueue['_queue'][0].requestOptions.retriesPerformedSoFar).toEqual(2)
    })

    describe('backoff calculation', () => {
        const retryDelaysOne = Array.from({ length: 10 }, (_, i) => i).map((i) => {
            return pickNextRetryDelay(i + 1)
        })
        const retryDelaysTwo = Array.from({ length: 10 }, (_, i) => i).map((i) => {
            return pickNextRetryDelay(i + 1)
        })
        const retryDelaysThree = Array.from({ length: 10 }, (_, i) => i).map((i) => {
            return pickNextRetryDelay(i + 1)
        })

        it('retry times are not identical each time they are generated', () => {
            retryDelaysOne.forEach((delay, i) => {
                expect(delay).not.toEqual(retryDelaysTwo[i])
                expect(delay).not.toEqual(retryDelaysThree[i])
            })
        })

        it('retry times are within bounds +/- jitter of 50%', () => {
            retryDelaysOne
                .concat(retryDelaysTwo)
                .concat(retryDelaysThree)
                .forEach((delay) => {
                    expect(delay).toBeGreaterThanOrEqual(6000 * 0.5)
                    expect(delay).toBeLessThanOrEqual(30 * 60 * 1000 * 1.5)
                })
        })
    })

    describe('memory management', () => {
        it('stops polling when queue becomes empty', () => {
            enqueueRequests()

            expect(retryQueue['_isPolling']).toBe(true)
            expect(retryQueue['_poller']).toBeDefined()
            expect(retryQueue.length).toEqual(4)

            fastForwardTimeAndRunTimer(3500)

            expect(retryQueue.length).toEqual(0)
            expect(retryQueue['_isPolling']).toBe(false)
            expect(retryQueue['_poller']).toBeUndefined()
        })

        it('restarts polling when items are added after stopping', () => {
            enqueueRequests()
            fastForwardTimeAndRunTimer(3500)

            expect(retryQueue['_isPolling']).toBe(false)
            expect(retryQueue['_poller']).toBeUndefined()

            mockTransport.mockImplementation(({ callback }) => {
                callback?.({ statusCode: 502 })
            })

            retryQueue.retriableRequest({
                url: '/e',
                data: { event: 'new-event', timestamp: now },
            })

            expect(retryQueue.length).toEqual(1)
            expect(retryQueue['_isPolling']).toBe(true)
            expect(retryQueue['_poller']).toBeDefined()
        })

        it('cleans up resources on unload', () => {
            enqueueRequests()

            expect(retryQueue['_isPolling']).toBe(true)
            expect(retryQueue['_poller']).toBeDefined()

            retryQueue.unload()

            expect(retryQueue['_isPolling']).toBe(false)
            expect(retryQueue['_poller']).toBeUndefined()
            expect(retryQueue.length).toEqual(0)
        })
    })
})
