/* eslint-disable compat/compat */

import { pickNextRetryDelay, RetryQueue } from '../retry-queue'
import { assignableWindow } from '../utils/globals'

describe('RetryQueue', () => {
    const mockPosthog = {
        _send_request: jest.fn(),
    }
    let retryQueue: RetryQueue
    let retryQueuePrivate: any
    let now = Date.now()

    beforeEach(() => {
        retryQueue = new RetryQueue(mockPosthog as any)
        retryQueuePrivate = retryQueue as any

        jest.useFakeTimers()
        jest.setSystemTime(now)
        jest.spyOn(assignableWindow.console, 'warn').mockImplementation()
    })

    const fastForwardTimeAndRunTimer = (time = 3500) => {
        now += time
        jest.setSystemTime(now)
        jest.runOnlyPendingTimers()
    }

    const enqueueRequests = () => {
        mockPosthog._send_request.mockImplementation(({ callback }) => {
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

        mockPosthog._send_request.mockImplementation(({ callback }) => {
            callback?.({ statusCode: 200 })
        })

        expect(mockPosthog._send_request).toHaveBeenCalledTimes(4)
        mockPosthog._send_request.mockClear()
    }

    it('processes retry requests', () => {
        enqueueRequests()

        expect(retryQueuePrivate.queue.length).toEqual(4)
        expect(retryQueuePrivate.queue).toEqual([
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
        expect(retryQueuePrivate.queue.length).toEqual(0)
        expect(mockPosthog._send_request).toHaveBeenCalledTimes(4)
        // Check the retry count is added
        expect(mockPosthog._send_request.mock.calls.map(([arg1]) => arg1.url)).toEqual([
            '/e?retry_count=1',
            '/e?retry_count=1',
            '/e?retry_count=1',
            '/e?retry_count=1',
        ])
    })

    it('adds the retry_count to the url', () => {
        enqueueRequests()
        fastForwardTimeAndRunTimer(3500)

        expect(mockPosthog._send_request.mock.calls.map(([arg1]) => arg1.url)).toEqual([
            '/e?retry_count=1',
            '/e?retry_count=1',
            '/e?retry_count=1',
            '/e?retry_count=1',
        ])
    })

    it('tries to send requests via beacon on unload', () => {
        enqueueRequests()

        retryQueue.unload()

        expect(retryQueuePrivate.queue.length).toEqual(0)
        expect(mockPosthog._send_request).toHaveBeenCalledTimes(4)
        expect(mockPosthog._send_request.mock.calls.map(([arg1]) => arg1.transport)).toEqual([
            'sendBeacon',
            'sendBeacon',
            'sendBeacon',
            'sendBeacon',
        ])
    })

    it('enqueues requests when offline and flushes immediately when online again', () => {
        retryQueuePrivate.areWeOnline = false
        expect(retryQueuePrivate.areWeOnline).toEqual(false)

        enqueueRequests()
        fastForwardTimeAndRunTimer()

        // requests aren't attempted when we're offline
        expect(mockPosthog._send_request).toHaveBeenCalledTimes(0)

        // queue stays the same
        expect(retryQueuePrivate.queue.length).toEqual(4)

        window.dispatchEvent(new Event('online'))

        expect(retryQueuePrivate.areWeOnline).toEqual(true)
        expect(retryQueuePrivate.queue.length).toEqual(0)
        expect(mockPosthog._send_request).toHaveBeenCalledTimes(4)
    })

    it('does not enqueue a request after 10 retries', () => {
        retryQueue.retriableRequest({
            url: '/e',
            data: { event: 'maxretries', timestamp: now },
            retriesPerformedSoFar: 10,
        })

        expect(retryQueuePrivate.queue.length).toEqual(0)
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
})
