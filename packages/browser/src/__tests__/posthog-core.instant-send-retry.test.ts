import { isUndefined } from '@posthog/core'
import { createPosthogInstance } from './helpers/posthog-instance'
import { PostHog } from '../posthog-core'
import { navigator, XMLHttpRequest } from '@posthog/browser-common/utils/globals'

const responseState = vi.hoisted(() => ({ status: undefined as number | undefined }))

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => {
    const original = await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()
    return {
        ...original,
        fetch: undefined,
        CompressionStream: undefined,
        navigator: { sendBeacon: vi.fn(() => true) },
        XMLHttpRequest: vi.fn(() => {
            const xhr = {
                open: vi.fn(),
                setRequestHeader: vi.fn(),
                send: vi.fn(),
                readyState: 0,
                status: 0,
                responseText: '{}',
                onreadystatechange: undefined as (() => void) | undefined,
            }
            xhr.send.mockImplementation(() => {
                if (!isUndefined(responseState.status)) {
                    xhr.readyState = 4
                    xhr.status = responseState.status
                    xhr.onreadystatechange?.()
                }
            })
            return xhr
        }),
    }
})

describe.each([true, false])('unbatched capture retries without fetch (request_batching: %s)', (request_batching) => {
    let posthog: PostHog

    beforeEach(async () => {
        responseState.status = undefined
        posthog = await createPosthogInstance(undefined, {
            request_batching,
            capture_pageview: false,
            capture_pageleave: false,
            advanced_disable_flags: true,
        })
        vi.mocked(navigator!.sendBeacon!).mockReset().mockReturnValue(true)
        posthog.set_config({ before_send: (event) => event })
    })

    afterEach(() => {
        posthog._retryQueue?.unload()
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    it.each([0, 503])('retries a rejected unload beacon with XHR after status %s', async (status) => {
        vi.useFakeTimers()
        vi.spyOn(Math, 'random').mockReturnValue(0.5)
        window.dispatchEvent(new Event('pagehide'))
        await vi.advanceTimersByTimeAsync(0)
        const mockBeacon = vi.mocked(navigator!.sendBeacon!)
        mockBeacon.mockClear().mockReturnValueOnce(false)
        vi.mocked(XMLHttpRequest!).mockClear()
        responseState.status = status

        posthog.capture('conversion', {}, { send_instantly: true })

        expect(mockBeacon).toHaveBeenCalledTimes(1)
        expect(XMLHttpRequest).toHaveBeenCalledTimes(1)
        expect(posthog._retryQueue?.length).toBe(1)

        window.dispatchEvent(new Event('pageshow'))
        responseState.status = 200
        await vi.advanceTimersByTimeAsync(6000)

        expect(mockBeacon).toHaveBeenCalledTimes(1)
        expect(XMLHttpRequest).toHaveBeenCalledTimes(2)
        expect(posthog._retryQueue?.length).toBe(0)
    })

    it.each([0, 503])('retains an event for retry after status %s on an active page', (status) => {
        responseState.status = status
        expect(posthog._isPageUnloading).toBe(false)
        expect(posthog._retryQueue?.length).toBe(0)

        posthog.capture('conversion', {}, request_batching ? { send_instantly: true } : undefined)

        expect(posthog._retryQueue?.length).toBe(1)
    })
})
