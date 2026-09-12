import { createPosthogInstance } from './helpers/posthog-instance'
import { PostHog } from '../posthog-core'
import { fetch, navigator } from '@posthog/browser-common/utils/globals'

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => {
    const original = await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()
    return {
        ...original,
        CompressionStream: undefined,
        fetch: vi.fn(),
        navigator: { ...original.navigator, sendBeacon: vi.fn(() => true) },
    }
})

describe.each([true, false])('unload capture retries (request_batching: %s)', (request_batching) => {
    let posthog: PostHog
    const mockFetch = vi.mocked(fetch!)
    const mockBeacon = vi.mocked(navigator!.sendBeacon!)

    beforeEach(async () => {
        mockFetch.mockReset()
        mockBeacon.mockReset().mockReturnValue(true)
        posthog = await createPosthogInstance(undefined, {
            request_batching,
            capture_pageview: false,
            capture_pageleave: false,
            advanced_disable_flags: true,
        })
        posthog.set_config({ before_send: (event) => event })
        vi.useFakeTimers()
        vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })

    afterEach(() => {
        posthog._retryQueue?.unload()
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    const respondWith = (status: number) => {
        mockFetch.mockResolvedValue({ status, text: () => Promise.resolve('{}') } as Response)
    }

    it.each([0, 503])('keeps retrying after a rejected unload beacon and status %s', async (status) => {
        if (status === 0) {
            mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))
        } else {
            respondWith(status)
        }
        window.dispatchEvent(new Event('pagehide'))
        await vi.advanceTimersByTimeAsync(0)
        mockBeacon.mockClear().mockReturnValueOnce(false)
        mockFetch.mockClear()

        posthog.capture('conversion', {}, { send_instantly: true })
        await vi.advanceTimersByTimeAsync(0)

        expect(mockBeacon).toHaveBeenCalledTimes(1)
        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(mockFetch.mock.calls[0][1]?.keepalive).toBe(false)
        expect(posthog._retryQueue?.length).toBe(1)

        window.dispatchEvent(new Event('pageshow'))
        expect(posthog._isPageUnloading).toBe(false)
        respondWith(503)
        await vi.advanceTimersByTimeAsync(6000)

        expect(mockBeacon).toHaveBeenCalledTimes(1)
        expect(mockFetch).toHaveBeenCalledTimes(2)
        expect(mockFetch.mock.calls[1][1]?.keepalive).toBe(true)
        expect(posthog._retryQueue?.length).toBe(1)

        respondWith(200)
        await vi.advanceTimersByTimeAsync(9000)

        expect(mockBeacon).toHaveBeenCalledTimes(1)
        expect(mockFetch).toHaveBeenCalledTimes(3)
        expect(posthog._retryQueue?.length).toBe(0)
    })

    it('preserves a caller-selected beacon on retry', async () => {
        respondWith(503)
        window.dispatchEvent(new Event('pagehide'))
        await vi.advanceTimersByTimeAsync(0)
        mockBeacon.mockClear().mockReturnValueOnce(false)
        mockFetch.mockClear()

        posthog.capture('conversion', {}, { send_instantly: true, transport: 'sendBeacon' })
        await vi.advanceTimersByTimeAsync(0)
        expect(posthog._retryQueue?.length).toBe(1)

        window.dispatchEvent(new Event('pageshow'))
        await vi.advanceTimersByTimeAsync(6000)

        expect(mockBeacon).toHaveBeenCalledTimes(2)
        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(posthog._retryQueue?.length).toBe(0)
    })
})
