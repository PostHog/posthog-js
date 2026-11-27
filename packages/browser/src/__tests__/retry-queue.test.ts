import { pickNextRetryDelay, RetryQueue } from '../retry-queue'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { createPosthogInstance } from './helpers/posthog-instance'
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
        get_distinct_id: () => 'user',
        sessionManager: { peekSessionAndWindowId: () => ({ sessionId: 'session', windowId: 'tab' }) },
        config: { token: 'test-replay', persistence: 'sessionStorage' },
        consent: { isOptedOut: () => false },
        persistence: { _disabled: false },
    }
    let retryQueue: RetryQueue
    let now = Date.now()

    beforeEach(() => {
        mockTransport.mockReset()
        retryQueue = new RetryQueue(mockPosthog as any)

        vi.useFakeTimers()
        vi.setSystemTime(now)
        assignableWindow.POSTHOG_DEBUG = false
        vi.spyOn(assignableWindow.console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        retryQueue.unload()
        vi.useRealTimers()
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

    describe('replay retry across a reload', () => {
        function sendSnapshot(uuid: string, windowId = 'tab', snapshotData?: unknown[]) {
            retryQueue.retriableRequest({
                batchKey: 'recordings',
                batchGroup: 'session-' + windowId,
                url: '/s/',
                data: [
                    {
                        event: '$snapshot',
                        uuid,
                        properties: {
                            token: mockPosthog.config.token,
                            distinct_id: 'user',
                            $session_id: 'session',
                            $window_id: windowId,
                            $snapshot_data: snapshotData,
                        },
                    },
                ],
            })
        }

        function failAndLeave(navigationType: string) {
            mockTransport.mockImplementationOnce(({ callback }) => callback({ statusCode: 503 }))
            sendSnapshot('first')
            window.dispatchEvent(Object.assign(new Event('pageswap'), { activation: { navigationType } }))
            retryQueue.unload()
        }

        function loadNextPage(windowId = 'tab') {
            retryQueue = new RetryQueue(mockPosthog as unknown as PostHog)
            sendSnapshot('next', windowId)
            fastForwardTimeAndRunTimer(60_000)
        }

        afterEach(() => window.sessionStorage.clear())

        it('delivers the original UUID once from the next recording, respecting backoff', () => {
            failAndLeave('reload')
            expect(mockTransport).toHaveBeenCalledTimes(1)
            retryQueue = new RetryQueue(mockPosthog as unknown as PostHog)
            sendSnapshot('next')
            expect(mockTransport).toHaveBeenCalledTimes(2)
            fastForwardTimeAndRunTimer(60_000)
            expect(mockTransport.mock.calls.map(([req]) => req.data[0].uuid)).toEqual(['first', 'next', 'first'])
            expect(mockTransport.mock.lastCall?.[0].url).toBe('/s/?retry_count=1')
            loadNextPage()
            expect(mockTransport).toHaveBeenCalledTimes(4)
        })

        it('uses the beacon for other navigations', () => {
            failAndLeave('push')
            expect(mockTransport.mock.lastCall?.[0].transport).toBe('sendBeacon')
            loadNextPage()
            expect(mockTransport).toHaveBeenCalledTimes(3)
        })

        it('discards the batch in a different window', () => {
            failAndLeave('reload')
            loadNextPage('duplicate-tab')
            expect(mockTransport).toHaveBeenCalledTimes(2)
        })

        it('discards a handoff when replay retries are cleared', () => {
            failAndLeave('reload')
            retryQueue.clearReplayRetries()
            loadNextPage()
            expect(mockTransport).toHaveBeenCalledTimes(2)
        })

        it.each(['queued batch', 'in-flight direct upload'])(
            'preserves in-memory retries after a config update with persistence disabled (%s)',
            async (scenario) => {
                const posthog = await createPosthogInstance(undefined, { disable_persistence: true })
                const snapshot = { event: '$snapshot', uuid: 'before-config-update' }
                const isQueued = scenario === 'queued batch'
                const data = isQueued ? [snapshot] : snapshot
                try {
                    posthog._send_retriable_request({ batchKey: 'recordings', url: '/s/', data })
                    const respond = mockTransport.mock.lastCall![0].callback
                    if (isQueued) respond({ statusCode: 503 })
                    expect(posthog._retryQueue?.length).toBe(isQueued ? 1 : 0)

                    posthog.set_config({ capture_pageview: false })
                    if (!isQueued) respond({ statusCode: 503 })
                    fastForwardTimeAndRunTimer(60_000)
                    expect(mockTransport).toHaveBeenCalledWith(
                        expect.objectContaining({ url: '/s/?retry_count=1', data })
                    )
                } finally {
                    await posthog.shutdown()
                }
            }
        )

        it.each(['queued', 'in flight'])(
            'preserves pre-reset %s snapshots with the original identity',
            async (state) => {
                const ph = await createPosthogInstance(undefined, { before_send: undefined })
                try {
                    const originalId = ph.get_distinct_id()
                    const data = [{ event: '$snapshot', properties: { distinct_id: originalId } }]
                    ph._send_retriable_request({ batchKey: 'recordings', url: '/s/', data })
                    const respond = mockTransport.mock.lastCall![0].callback
                    if (state === 'queued') respond({ statusCode: 503 })
                    ph.reset()
                    expect(ph.get_distinct_id()).not.toBe(originalId)
                    if (state === 'in flight') respond({ statusCode: 503 })
                    fastForwardTimeAndRunTimer(60_000)
                    expect(mockTransport).toHaveBeenCalledWith(
                        expect.objectContaining({ url: '/s/?retry_count=1', data })
                    )
                } finally {
                    await ph.shutdown()
                }
            }
        )

        it.each(['reset', 'deferred bootstrap', 'expired session', 'idle timeout'])(
            'does not rotate a session on reload after %s',
            async (scenario) => {
                const ph = await createPosthogInstance(undefined, { before_send: undefined })
                try {
                    const { sessionId, windowId } = ph.sessionManager!.checkAndGetSessionAndWindowId()
                    const properties = {
                        token: ph.config.token,
                        distinct_id: ph.get_distinct_id(),
                        $session_id: sessionId,
                        $window_id: windowId,
                    }
                    mockTransport.mockImplementationOnce(({ callback }) => callback({ statusCode: 503 }))
                    ph._send_retriable_request({
                        batchKey: 'recordings',
                        batchGroup: sessionId + '-' + windowId,
                        url: '/s/',
                        data: [{ event: '$snapshot', uuid: 'old-page', properties }],
                    })
                    expect(ph._retryQueue?.length).toBe(1)
                    const changed = vi.fn()
                    ph.onSessionId(changed)
                    const bootstrapId = uuidv7()
                    if (scenario === 'expired session') vi.setSystemTime(Date.now() + 25 * 3600_000)
                    else if (scenario === 'idle timeout') vi.setSystemTime(Date.now() + 31 * 60_000)
                    else if (scenario === 'deferred bootstrap') ph.reset({ bootstrap: { sessionID: bootstrapId } })
                    else ph.reset()
                    changed.mockClear()
                    const previous = [...ph.persistence!.props.$sesid]
                    window.dispatchEvent(
                        Object.assign(new Event('pageswap'), { activation: { navigationType: 'reload' } })
                    )
                    expect(changed).not.toHaveBeenCalled()
                    expect(ph.persistence!.props.$sesid).toEqual(previous)
                    expect(ph._retryQueue?.length).toBe(1)
                    ph._retryQueue!.unload()
                    expect(mockTransport.mock.lastCall?.[0]).toMatchObject({
                        transport: 'sendBeacon',
                        data: [{ uuid: 'old-page' }],
                    })
                    if (scenario === 'deferred bootstrap')
                        expect(ph.sessionManager!.checkAndGetSessionAndWindowId().sessionId).toBe(bootstrapId)
                } finally {
                    await ph.shutdown()
                }
            }
        )

        it('leaves a previous identity’s batch on the beacon path', () => {
            const identity = vi.spyOn(mockPosthog, 'get_distinct_id').mockReturnValue('another-user')
            try {
                failAndLeave('reload')
                expect(mockTransport.mock.lastCall?.[0].transport).toBe('sendBeacon')
                expect(window.sessionStorage.length).toBe(0)
            } finally {
                identity.mockRestore()
            }
        })

        it('keeps a batch with an unserializable payload on the beacon path', () => {
            mockTransport.mockImplementationOnce(({ callback, data }) => {
                data[0].properties.circular = data
                callback({ statusCode: 503 })
            })
            sendSnapshot('cyclic')
            window.dispatchEvent(Object.assign(new Event('pageswap'), { activation: { navigationType: 'reload' } }))
            retryQueue.unload()
            expect(mockTransport.mock.lastCall?.[0].transport).toBe('sendBeacon')
        })

        it.each([{ disable_session_recording: true }, { persistence: 'memory' as const }])(
            'keeps a pending handoff during delayed startup (%j)',
            async (config) => {
                const token = uuidv7()
                const key = 'ph_replay_retry_' + JSON.stringify([token, token])
                window.sessionStorage.setItem(key, 'pending')
                const ph = await createPosthogInstance(token, { before_send: undefined, ...config })
                try {
                    ph.set_config({ capture_pageview: false })
                    expect(window.sessionStorage.getItem(key)).toBe('pending')
                    ph.set_config({ persistence: 'sessionStorage' })
                    ph.startSessionRecording()
                    expect(window.sessionStorage.getItem(key)).toBe('pending')
                    ph.stopSessionRecording()
                    expect(window.sessionStorage.getItem(key)).toBeNull()
                } finally {
                    await ph.shutdown()
                }
            }
        )

        it.each([
            { persistence: 'memory' as const },
            { before_send: () => null },
            { session_recording: { selectMaskingFn: () => 'masked' as const } },
        ])('clears stored replay on an explicit privacy config change', async (config) => {
            const token = uuidv7()
            const key = 'ph_replay_retry_' + JSON.stringify([token, token])
            const ph = await createPosthogInstance(token, { before_send: undefined })
            try {
                window.sessionStorage.setItem(key, 'pending')
                ph.set_config(config)
                expect(window.sessionStorage.getItem(key)).toBeNull()
            } finally {
                await ph.shutdown()
            }
        })

        it('does not access the handoff key in always-cookieless mode', async () => {
            const remove = vi.spyOn(Storage.prototype, 'removeItem')
            try {
                const ph = await createPosthogInstance(undefined, { cookieless_mode: 'always' })
                await ph.shutdown()
                expect(remove).not.toHaveBeenCalledWith(expect.stringContaining('ph_replay_retry_'))
            } finally {
                remove.mockRestore()
            }
        })

        it('removes an expired handoff at startup before replay sends a request', () => {
            failAndLeave('reload')
            expect(window.sessionStorage.length).toBe(1)
            vi.setSystemTime(Date.now() + 31 * 60_000)
            retryQueue = new RetryQueue(mockPosthog as unknown as PostHog)
            expect(window.sessionStorage.length).toBe(0)
        })

        it('keeps later batches on the beacon path if the first matching batch exceeds the cap', () => {
            mockTransport.mockImplementation(({ callback }) => callback?.({ statusCode: 503 }))
            sendSnapshot('full', 'tab', [{ type: 2, data: 'a'.repeat(256 * 1024) }])
            sendSnapshot('incremental', 'tab', [{ type: 3, data: {} }])
            window.dispatchEvent(Object.assign(new Event('pageswap'), { activation: { navigationType: 'reload' } }))
            expect(window.sessionStorage.length).toBe(0)
            expect(retryQueue.length).toBe(2)
        })

        it('discards an expired handoff', () => {
            failAndLeave('reload')
            fastForwardTimeAndRunTimer(31 * 60_000)
            loadNextPage()
            expect(mockTransport).toHaveBeenCalledTimes(2)
        })

        it('discards stored data when the next page opts out', () => {
            failAndLeave('reload')
            const consent = vi.spyOn(mockPosthog.consent, 'isOptedOut').mockReturnValue(true)
            try {
                loadNextPage()
                expect(mockTransport).toHaveBeenCalledTimes(2)
                expect(window.sessionStorage.length).toBe(0)
            } finally {
                consent.mockRestore()
            }
        })

        it('falls back to the beacon when storage cannot accept the handoff', () => {
            const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new Error('Quota exceeded')
            })
            try {
                failAndLeave('reload')
                expect(mockTransport.mock.lastCall?.[0].transport).toBe('sendBeacon')
            } finally {
                write.mockRestore()
            }
        })
    })

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

    it('strips batch callbacks on unload without stripping single-event callbacks', () => {
        const batchCallback = vi.fn()
        const singleCallback = vi.fn()
        mockTransport.mockImplementation(({ callback }) => callback?.({ statusCode: 503 }))
        retryQueue.retriableRequest({ url: '/e', data: [{ event: 'batched' }], callback: batchCallback })
        retryQueue.retriableRequest({ url: '/e', data: { event: 'single' }, callback: singleCallback })
        mockTransport.mockReset()

        retryQueue.unload()

        expect(mockTransport).toHaveBeenCalledTimes(2)
        expect(mockTransport.mock.calls[0][0].callback).toBeUndefined()
        expect(mockTransport.mock.calls[1][0].callback).toBe(singleCallback)
        expect(mockTransport.mock.calls.every(([request]) => request.transport === 'sendBeacon')).toBe(true)
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

    it.each([9, 10, 11])('enforces the retry limit after %i failed retries', (retriesPerformedSoFar) => {
        const callback = vi.fn()
        mockTransport.mockImplementation(({ callback }) => callback({ statusCode: 503 }))

        retryQueue.retriableRequest({
            url: '/e',
            data: { event: 'maxretries', timestamp: now },
            retriesPerformedSoFar,
            callback,
        })

        expect(mockTransport).toHaveBeenCalledOnce()
        if (retriesPerformedSoFar === 9) {
            expect(retryQueue.length).toBe(1)
            expect(retryQueue['_queue'][0].requestOptions.retriesPerformedSoFar).toBe(10)
            expect(callback).not.toHaveBeenCalled()
        } else {
            expect(retryQueue.length).toBe(0)
            expect(callback).toHaveBeenCalledOnce()
            expect(callback).toHaveBeenCalledWith({ statusCode: 503 })
        }
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
        it.each([
            [0, 0, 2250],
            [0, 0.5, 3000],
            [0, 0.999, 3749],
            [1, 0, 4500],
            [1, 0.5, 6000],
            [1, 0.999, 7497],
            [2, 0.5, 12000],
            [9, 0.5, 1536000],
            [10, 0.5, 1800000],
        ])('uses exponential backoff for attempt %i and draw %f', (attempt, draw, expected) => {
            const random = vi.spyOn(Math, 'random').mockReturnValue(draw)
            try {
                expect(pickNextRetryDelay(attempt)).toBe(expected)
                expect(pickNextRetryDelay(attempt)).toBe(expected)
            } finally {
                random.mockRestore()
            }
        })

        it.each([0, 0.5, 0.999])('keeps retry delays bounded for draw %f', (draw) => {
            const random = vi.spyOn(Math, 'random').mockReturnValue(draw)
            try {
                for (let attempt = 0; attempt <= 10; attempt++) {
                    expect(pickNextRetryDelay(attempt)).toBeGreaterThanOrEqual(2250)
                    expect(pickNextRetryDelay(attempt)).toBeLessThanOrEqual(2700000)
                }
            } finally {
                random.mockRestore()
            }
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
