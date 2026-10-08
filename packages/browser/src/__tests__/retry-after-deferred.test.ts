import { Response } from 'node-fetch'
import { fetch } from '@posthog/browser-common/utils/globals'
import { init_as_module } from '../posthog-core'
import { RetryQueue } from '../retry-queue'

// Exercise the legacy DOM-ready gate while retaining actual transport execution.
vi.mock('../request', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../request')>()),
    SUPPORTS_REQUEST: false,
}))
vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()),
    fetch: vi.fn(),
    userAgent: 'test-browser',
    CompressionStream: undefined,
}))

it('retains completion through DOM-ready deferral, with the drained retry attempt owning Retry-After', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const instance = init_as_module()
    instance.__loaded = true
    vi.spyOn(instance, 'is_capturing').mockReturnValue(true)
    instance.config.request_batching = false
    const queue = new RetryQueue(instance)
    instance._retryQueue = queue
    const callback = vi.fn()
    vi.mocked(fetch!)
        .mockResolvedValueOnce(
            new Response('', { status: 503, headers: { 'Retry-After': '20' } }) as unknown as globalThis.Response
        )
        .mockResolvedValue(new Response('{}', { status: 200 }) as unknown as globalThis.Response)

    try {
        queue.retriableRequest({ url: '/e/', callback })
        expect(instance.__request_queue).toHaveLength(1)
        expect(fetch).not.toHaveBeenCalled()
        expect(callback).not.toHaveBeenCalled()
        document.dispatchEvent(new Event('DOMContentLoaded'))
        await vi.advanceTimersByTimeAsync(0)
        expect(instance.__request_queue).toHaveLength(0)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(queue['_queue'][0].retryAt).toBe(20_000)
        await vi.advanceTimersByTimeAsync(20_000)
        expect(fetch).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1000)
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(queue.length).toBe(0)
        expect(callback.mock.calls).toEqual([[{ statusCode: 200, text: '{}', json: {} }]])
    } finally {
        queue.unload()
        vi.clearAllTimers()
        vi.useRealTimers()
        vi.restoreAllMocks()
    }
})
