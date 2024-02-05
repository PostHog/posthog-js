/* eslint-disable compat/compat */

import { pickNextRetryDelay, RetryQueue } from '../retry-queue'
import * as SendRequest from '../send-request'
import { RateLimiter } from '../rate-limiter'
import { SESSION_RECORDING_BATCH_KEY } from '../extensions/replay/sessionrecording'
import { assignableWindow } from '../utils/globals'
import { CaptureOptions } from '../types'

const EPOCH = 1_600_000_000
const defaultRequestOptions: CaptureOptions = {
    method: 'POST',
    transport: 'XHR',
}

describe('RetryQueue', () => {
    const onRequestError = jest.fn().mockImplementation(console.error)
    const rateLimiter = new RateLimiter()
    let retryQueue: RetryQueue

    const xhrMockClass = () => ({
        open: jest.fn(),
        send: jest.fn(),
        setRequestHeader: jest.fn(),
        status: 418,
    })

    beforeEach(() => {
        retryQueue = new RetryQueue(onRequestError, rateLimiter)
        assignableWindow.XMLHttpRequest = jest.fn().mockImplementation(xhrMockClass)
        assignableWindow.navigator.sendBeacon = jest.fn()

        jest.useFakeTimers()
        jest.spyOn(retryQueue, 'getTime').mockReturnValue(EPOCH)
        jest.spyOn(assignableWindow.console, 'warn').mockImplementation()
        rateLimiter.limits = {}
    })

    const fastForwardTimeAndRunTimer = () => {
        jest.spyOn(global.Date, 'now').mockImplementationOnce(() => new Date().getTime() + 3500)
        jest.runOnlyPendingTimers()
    }

    const enqueueRequests = () => {
        retryQueue.enqueue({
            url: '/e',
            data: { event: 'foo', timestamp: EPOCH - 3000 },
            options: defaultRequestOptions,
        })
        retryQueue.enqueue({
            url: '/e',
            data: { event: 'bar', timestamp: EPOCH - 2000 },
            options: defaultRequestOptions,
        })
        retryQueue.enqueue({
            url: '/e',
            data: { event: 'baz', timestamp: EPOCH - 1000 },
            options: defaultRequestOptions,
        })
        retryQueue.enqueue({
            url: '/e',
            data: { event: 'fizz', timestamp: EPOCH },
            options: defaultRequestOptions,
        })
    }

    it('processes retry requests', () => {
        enqueueRequests()

        expect(retryQueue.queue.length).toEqual(4)

        expect(retryQueue.queue).toEqual([
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

        expect(assignableWindow.XMLHttpRequest).toHaveBeenCalledTimes(0)

        fastForwardTimeAndRunTimer()

        // clears queue
        expect(retryQueue.queue.length).toEqual(0)

        expect(assignableWindow.XMLHttpRequest).toHaveBeenCalledTimes(4)
        expect(onRequestError).toHaveBeenCalledTimes(0)
    })

    it('does not process event retry requests when events are rate limited', () => {
        rateLimiter.limits = {
            events: new Date().getTime() + 10_000,
        }

        retryQueue.enqueue({
            url: '/e',
            data: { event: 'baz', timestamp: EPOCH - 1000 },
            options: defaultRequestOptions,
        })
        retryQueue.enqueue({
            url: '/e',
            data: { event: 'baz', timestamp: EPOCH - 500 },
            options: defaultRequestOptions,
        })
        retryQueue.enqueue({
            url: '/s',
            data: { event: 'fizz', timestamp: EPOCH },
            options: { ...defaultRequestOptions, _batchKey: SESSION_RECORDING_BATCH_KEY },
        })

        expect(retryQueue.queue.length).toEqual(3)
        expect(assignableWindow.XMLHttpRequest).toHaveBeenCalledTimes(0)

        fastForwardTimeAndRunTimer()

        // clears queue
        expect(retryQueue.queue.length).toEqual(0)
        expect(assignableWindow.XMLHttpRequest).toHaveBeenCalledTimes(1)
        expect(onRequestError).toHaveBeenCalledTimes(0)
    })

    it('does not process recording retry requests when they are rate limited', () => {
        rateLimiter.limits = {
            [SESSION_RECORDING_BATCH_KEY]: new Date().getTime() + 10_000,
        }

        retryQueue.enqueue({
            url: '/e',
            data: { event: 'baz', timestamp: EPOCH - 1000 },
            options: defaultRequestOptions,
        })
        retryQueue.enqueue({
            url: '/e',
            data: { event: 'baz', timestamp: EPOCH - 500 },
            options: defaultRequestOptions,
        })
        retryQueue.enqueue({
            url: '/s',
            data: { event: 'fizz', timestamp: EPOCH },
            options: { ...defaultRequestOptions, _batchKey: SESSION_RECORDING_BATCH_KEY },
        })

        expect(retryQueue.queue.length).toEqual(3)
        expect(assignableWindow.XMLHttpRequest).toHaveBeenCalledTimes(0)

        fastForwardTimeAndRunTimer()

        // clears queue
        expect(retryQueue.queue.length).toEqual(0)
        expect(assignableWindow.XMLHttpRequest).toHaveBeenCalledTimes(2)
        expect(onRequestError).toHaveBeenCalledTimes(0)
    })

    it('tries to send requests via beacon on unload', () => {
        enqueueRequests()

        retryQueue.poll()
        retryQueue.unload()

        expect(retryQueue.queue.length).toEqual(0)
        expect(assignableWindow.navigator.sendBeacon).toHaveBeenCalledTimes(4)
    })

    it('does not try to send requests via beacon on unload when rate limited', () => {
        rateLimiter.limits = {
            events: new Date().getTime() + 10_000,
        }
        enqueueRequests()

        retryQueue.unload()

        expect(retryQueue.queue.length).toEqual(0)
        expect(assignableWindow.navigator.sendBeacon).toHaveBeenCalledTimes(0)
    })

    it('when you flush the queue onError is passed to xhr', () => {
        const xhrSpy = jest.spyOn(SendRequest, 'request')
        enqueueRequests()
        retryQueue.flush()
        fastForwardTimeAndRunTimer()
        expect(xhrSpy).toHaveBeenCalledWith(expect.objectContaining({ onError: onRequestError }))
    })

    it('enqueues requests when offline and flushes immediately when online again', () => {
        retryQueue.areWeOnline = false
        expect(retryQueue.areWeOnline).toEqual(false)

        enqueueRequests()

        fastForwardTimeAndRunTimer()

        // requests aren't attempted when we're offline
        expect(assignableWindow.XMLHttpRequest).toHaveBeenCalledTimes(0)
        // doesn't log that it is offline from the retry queue
        expect(onRequestError).toHaveBeenCalledTimes(0)

        // queue stays the same
        expect(retryQueue.queue.length).toEqual(4)

        retryQueue._handleWeAreNowOnline()

        expect(retryQueue.areWeOnline).toEqual(true)
        expect(retryQueue.queue.length).toEqual(0)

        expect(assignableWindow.XMLHttpRequest).toHaveBeenCalledTimes(4)
    })

    it('retries using an exponential backoff mechanism', () => {
        const fixedDate = new Date('2021-05-31T00:00:00')
        jest.spyOn(global.Date, 'now').mockImplementation(() => fixedDate.getTime())

        retryQueue.enqueue({
            url: '/e',
            data: { event: '1retry', timestamp: EPOCH },
            options: defaultRequestOptions,
            retriesPerformedSoFar: 1,
        })

        retryQueue.enqueue({
            url: '/e',
            data: { event: '5retries', timestamp: EPOCH },
            options: defaultRequestOptions,
            retriesPerformedSoFar: 5,
        })

        retryQueue.enqueue({
            url: '/e',
            data: { event: '9retries', timestamp: EPOCH },
            options: defaultRequestOptions,
            retriesPerformedSoFar: 9,
        })

        expect(retryQueue.queue).toEqual([
            {
                requestData: {
                    url: '/e',
                    data: { event: '1retry', timestamp: EPOCH },
                    options: defaultRequestOptions,
                    retriesPerformedSoFar: 1,
                },
                retryAt: expect.any(Date),
            },
            {
                requestData: {
                    url: '/e',
                    data: { event: '5retries', timestamp: EPOCH },
                    options: defaultRequestOptions,
                    retriesPerformedSoFar: 5,
                },
                retryAt: expect.any(Date),
            },
            {
                requestData: {
                    url: '/e',
                    data: { event: '9retries', timestamp: EPOCH },
                    options: defaultRequestOptions,
                    retriesPerformedSoFar: 9,
                },
                retryAt: expect.any(Date),
            },
        ])
    })

    it('does not enqueue a request after 10 retries', () => {
        retryQueue.enqueue({
            url: '/e',
            data: { event: 'maxretries', timestamp: EPOCH },
            options: defaultRequestOptions,
            retriesPerformedSoFar: 10,
        })

        expect(retryQueue.queue.length).toEqual(0)
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
