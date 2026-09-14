import { Response } from 'node-fetch'
import { PostHog } from '../posthog-core'
import { RetryQueue } from '../retry-queue'
import { request } from '../request'
import { fetch, navigator, XMLHttpRequest } from '@posthog/browser-common/utils/globals'
import type { RequestWithOptions } from '../types'

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()),
    fetch: vi.fn(),
    XMLHttpRequest: vi.fn(),
    CompressionStream: undefined,
    navigator: { sendBeacon: vi.fn(() => true) },
}))

const start = Date.parse('2026-01-01T00:00:00Z')

describe.each(['fetch', 'XHR'] as const)('Retry-After through %s and RetryQueue', (transport) => {
    let instance: PostHog
    let queue: RetryQueue
    let attempts: number[]
    let callback: ReturnType<typeof vi.fn>
    let header: string | undefined
    let status: number
    let body: string
    let throwOnHeaderRead: boolean
    let errorHook: ReturnType<typeof vi.fn>

    const send = (options: Partial<RequestWithOptions> = {}) =>
        queue.retriableRequest({ url: '/e/', transport, callback, ...options })

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(start)
        vi.spyOn(Math, 'random').mockReturnValue(0.5)
        attempts = []
        callback = vi.fn()
        header = '20'
        status = 503
        body = '<html>Unavailable</html>'
        throwOnHeaderRead = false
        vi.mocked(navigator!.sendBeacon!).mockReturnValue(true)
        instance = new PostHog()
        instance.__loaded = true
        errorHook = vi.fn()
        instance.config.on_request_error = errorHook
        queue = new RetryQueue(instance)
        vi.mocked(fetch!).mockImplementation(async () => {
            attempts.push(Date.now() - start)
            const response = new Response(body, { status, headers: header ? { 'Retry-After': header } : {} })
            if (throwOnHeaderRead) {
                response.headers.get = () => {
                    throw new Error('Header unavailable')
                }
            }
            return response as unknown as globalThis.Response
        })
        vi.mocked(XMLHttpRequest!).mockImplementation(function () {
            const xhr = {
                readyState: 0,
                status: 0,
                responseText: '',
                onreadystatechange: () => {},
                open: vi.fn(),
                setRequestHeader: vi.fn(),
                getResponseHeader: () => {
                    if (throwOnHeaderRead) {
                        throw new Error('Header unavailable')
                    }
                    return header ?? null
                },
                send: () => {
                    attempts.push(Date.now() - start)
                    xhr.readyState = 4
                    xhr.status = status
                    xhr.responseText = body
                    xhr.onreadystatechange()
                },
            }
            return xhr as unknown as globalThis.XMLHttpRequest
        })
    })

    afterEach(() => {
        queue.unload()
        vi.clearAllTimers()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it.each([
        ['20', 20_000],
        [' 20 ', 20_000],
        ['Thu, 01 Jan 2026 00:00:20 GMT', 20_000],
        ['120', 30_000],
        ['Thu, 01 Jan 2026 00:02:00 GMT', 30_000],
        ['999999999999999999999999', 30_000],
        ['9'.repeat(400), 30_000],
        ['Fri, 01 Jan 9999 00:00:00 GMT', 30_000],
        ['Thursday, 01-Jan-26 00:00:20 GMT', 20_000],
        ['Thu Jan  1 00:00:20 2026', 20_000],
        ['+20', 3000],
        ['Thu, nonsense', 3000],
        [undefined, 3000],
        ['', 3000],
        ['0', 3000],
        ['1', 3000],
        ['-20', 3000],
        ['1.5', 3000],
        ['1e2', 3000],
        ['Infinity', 3000],
        ['NaN', 3000],
        ['invalid', 3000],
        ['20 seconds', 3000],
        ['2026', 30_000],
        ['Thu, 01 Jan 2026 00:00:00 GMT', 3000],
        ['Wed, 31 Dec 2025 23:59:00 GMT', 3000],
    ])('schedules %j with a bounded header component: %i ms', async (value, expected) => {
        header = value
        send()
        await vi.advanceTimersByTimeAsync(0)
        expect(queue['_queue'][0].retryAt - start).toBe(expected)
        expect(callback).not.toHaveBeenCalled()
        expect(errorHook.mock.calls).toEqual([[{ statusCode: 503, text: body }]])
        await vi.advanceTimersByTimeAsync(expected)
        expect(attempts).toEqual([0])
        status = 200
        body = '{}'
        await vi.advanceTimersByTimeAsync(3000)
        expect(attempts).toEqual([0, expected + 3000 - (expected % 3000)])
        expect(callback.mock.calls).toEqual([[{ statusCode: 200, text: '{}', json: {} }]])
        expect(queue.length).toBe(0)
    })

    it('falls back if reading a header throws', async () => {
        throwOnHeaderRead = true
        send()
        await vi.advanceTimersByTimeAsync(0)
        expect(queue['_queue'][0].retryAt - start).toBe(3000)
        expect(errorHook.mock.calls).toEqual([[{ statusCode: 503, text: body }]])
    })

    it('never shortens a longer jittered exponential delay', async () => {
        header = '120'
        vi.spyOn(Math, 'random').mockReturnValue(0.9)
        queue.retriableRequest({ url: '/e/', transport, retriesPerformedSoFar: 4, callback })
        await vi.advanceTimersByTimeAsync(0)
        expect(queue['_queue'][0].retryAt - start).toBe(57_600)
    })

    it.each(['', '<html>Limited</html>', '{"error":"limited"}'])('keeps 429 terminal with body %j', async (text) => {
        status = 429
        body = text
        send()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(attempts).toEqual([0])
        expect(queue.length).toBe(0)
        expect(callback.mock.calls).toEqual([[{ statusCode: 429, text }]])
        expect(instance.rateLimiter.serverLimits).toEqual({})
    })

    it('keeps quota-body suppression and dropped callback behavior', async () => {
        status = 429
        body = '{"quota_limited":["events"]}'
        send({ fireCallbackOnDrop: true })
        await vi.advanceTimersByTimeAsync(0)
        expect(instance.rateLimiter.serverLimits.events).toBe(start + 60_000)
        await vi.advanceTimersByTimeAsync(59_999)
        send({ fireCallbackOnDrop: true })
        expect(attempts).toEqual([0])
        expect(callback.mock.calls).toEqual([[{ statusCode: 429, text: body }], [{ statusCode: 429 }]])
        expect(queue.length).toBe(0)
    })

    it('forwards only a public response to direct callbacks, after limiter and error hook', async () => {
        const order: string[] = []
        vi.spyOn(instance.rateLimiter, 'checkForLimiting').mockImplementation(() => {
            order.push('limiter')
        })
        errorHook.mockImplementation(() => {
            order.push('error')
        })
        callback.mockImplementation(() => {
            order.push('callback')
        })
        instance._send_request({ url: '/e/', transport, callback })
        await vi.advanceTimersByTimeAsync(0)
        expect(order).toEqual(['limiter', 'error', 'callback'])
        expect(callback.mock.calls).toEqual([[{ statusCode: 503, text: body }]])
    })

    it('forwards only one argument to a direct transport callback', async () => {
        request({ url: '/e/', transport, callback })
        await vi.advanceTimersByTimeAsync(0)
        expect(callback.mock.calls).toEqual([[{ statusCode: 503, text: body }]])
    })

    it('uses the header from each attempt independently', async () => {
        send()
        await vi.advanceTimersByTimeAsync(0)
        header = undefined
        await vi.advanceTimersByTimeAsync(21_000)
        expect(attempts).toEqual([0, 21_000])
        expect(queue['_queue'][0].retryAt).toBe(start + 27_000)
    })

    it('preserves best-effort beacon unload without waiting for the header deadline', async () => {
        send({ method: 'POST', data: { event: 'test' } })
        await vi.advanceTimersByTimeAsync(0)
        queue.unload()
        expect(navigator!.sendBeacon).toHaveBeenCalledTimes(1)
        expect(queue.length).toBe(0)
        expect(queue['_poller']).toBeUndefined()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(attempts).toEqual([0])
        expect(callback).not.toHaveBeenCalled()
    })

    it('preserves split-beacon fallback completions without leaking metadata', async () => {
        vi.mocked(navigator!.sendBeacon!).mockReturnValue(false)
        instance._send_request({
            url: '/e/',
            transport: 'sendBeacon',
            method: 'POST',
            data: [{ payload: 'x'.repeat(20_000) }, { payload: 'x'.repeat(20_000) }],
            callback,
        })
        await vi.advanceTimersByTimeAsync(0)
        expect(navigator!.sendBeacon).toHaveBeenCalledTimes(3)
        expect(attempts).toEqual([0, 0])
        expect(callback.mock.calls).toEqual([[{ statusCode: 503, text: body }], [{ statusCode: 503, text: body }]])
    })

    it('keeps the HTTP retry budget and public terminal callback', async () => {
        queue.retriableRequest({ url: '/e/', transport, retriesPerformedSoFar: 10, callback })
        await vi.advanceTimersByTimeAsync(60_000)
        expect(attempts).toEqual([0])
        expect(queue.length).toBe(0)
        expect(callback.mock.calls).toEqual([[{ statusCode: 503, text: body }]])
    })

    it('keeps the retry count bounded through a thirty-minute outage', async () => {
        header = '120'
        send()
        await vi.advanceTimersByTimeAsync(30 * 60_000)
        expect(attempts).toHaveLength(10)
        expect(queue.length).toBe(1)
        expect(callback).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(30 * 60_000)
        expect(attempts).toHaveLength(11)
        expect(queue.length).toBe(0)
        expect(callback.mock.calls).toEqual([[{ statusCode: 503, text: body }]])
    })

    it.each([false, true])('keeps rate-limited fireCallbackOnDrop=%s behavior', (fireCallbackOnDrop) => {
        instance.rateLimiter.serverLimits.events = start + 60_000
        instance._send_request({ url: '/e/', transport, callback, fireCallbackOnDrop })
        send({ fireCallbackOnDrop })
        expect(callback.mock.calls).toEqual(fireCallbackOnDrop ? [[{ statusCode: 429 }], [{ statusCode: 429 }]] : [])
        expect(attempts).toEqual([])
        expect(queue.length).toBe(0)
        expect(errorHook).not.toHaveBeenCalled()
    })

    it('does not bypass the header deadline on an online event', async () => {
        send()
        await vi.advanceTimersByTimeAsync(0)
        window.dispatchEvent(new Event('offline'))
        await vi.advanceTimersByTimeAsync(6000)
        window.dispatchEvent(new Event('online'))
        expect(attempts).toEqual([0])
        window.dispatchEvent(new Event('offline'))
        await vi.advanceTimersByTimeAsync(18_000)
        expect(attempts).toEqual([0])
        status = 200
        body = '{}'
        window.dispatchEvent(new Event('online'))
        await vi.advanceTimersByTimeAsync(0)
        expect(attempts).toEqual([0, 24_000])
        expect(queue.length).toBe(0)
    })

    if (transport === 'fetch') {
        it('preserves status-zero handling when body reading fails', async () => {
            vi.mocked(fetch!).mockResolvedValue({
                status: 503,
                headers: new Headers({ 'Retry-After': '20' }),
                text: () => Promise.reject(new Error('Body read failed')),
            } as unknown as globalThis.Response)
            send()
            await vi.advanceTimersByTimeAsync(0)
            expect(queue['_queue'][0].retryAt - start).toBe(3000)
            expect(callback).not.toHaveBeenCalled()
        })
    }

    it.each([false, true])('keeps not-loaded fireCallbackOnDrop=%s behavior', async (fireCallbackOnDrop) => {
        instance.__loaded = false
        instance._send_request({ url: '/e/', transport, callback, fireCallbackOnDrop })
        expect(callback.mock.calls).toEqual(fireCallbackOnDrop ? [[{ statusCode: 0 }]] : [])
        send({ fireCallbackOnDrop })
        expect(queue.length).toBe(fireCallbackOnDrop ? 1 : 0)
        expect(attempts).toEqual([])
    })
})
