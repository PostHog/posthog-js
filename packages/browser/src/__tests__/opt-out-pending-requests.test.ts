import { isArray } from '@posthog/core'
import type { PostHog } from '../posthog-core'
import type { RequestWithOptions } from '../types'
import type { TransportCallback } from '../request'
import { defaultPostHog } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'

const mockRequest = vi.hoisted(() => vi.fn())
vi.mock('../request', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../request')>()),
    request: (options: RequestWithOptions, onResponse?: TransportCallback) => mockRequest(options, onResponse),
}))

const sentEventNames = (): string[] =>
    mockRequest.mock.calls
        .filter(([options]) => options.url.includes('/e/'))
        .flatMap(([options]) => (isArray(options.data) ? options.data : [options.data]))
        .map((event) => event.event)

describe('opt_out_capturing() with pending requests', () => {
    let posthog: PostHog

    const createPostHog = (request_batching: boolean) =>
        defaultPostHog().init(
            'testtoken',
            {
                api_host: 'https://test.com',
                opt_out_capturing_by_default: true,
                capture_pageview: false,
                capture_pageleave: false,
                autocapture: false,
                disable_session_recording: true,
                advanced_disable_flags: true,
                disable_compression: true,
                request_batching,
            },
            uuidv7()
        )!

    beforeEach(() => {
        vi.useFakeTimers()
        mockRequest.mockReset()
        console.warn = vi.fn()
    })

    afterEach(() => {
        vi.clearAllTimers()
        vi.useRealTimers()
        localStorage.clear()
    })

    it('does not send a batched event captured before opting out', () => {
        posthog = createPostHog(true)
        posthog.opt_in_capturing({ captureEventName: false })

        posthog.capture('before-opt-out')
        posthog.opt_out_capturing()
        vi.advanceTimersByTime(10_000)

        expect(sentEventNames()).not.toContain('before-opt-out')
    })

    it('sends the batched event when capturing stays opted in', () => {
        posthog = createPostHog(true)
        posthog.opt_in_capturing({ captureEventName: false })

        posthog.capture('stays-opted-in')
        vi.advanceTimersByTime(10_000)

        expect(sentEventNames()).toContain('stays-opted-in')
    })

    it('does not retry a request that fails after opting out', () => {
        posthog = createPostHog(false)
        posthog.opt_in_capturing({ captureEventName: false })

        const pendingResponses: TransportCallback[] = []
        mockRequest.mockImplementation((_options, onResponse) => pendingResponses.push(onResponse))

        posthog.capture('in-flight')
        expect(sentEventNames()).toEqual(['in-flight'])

        posthog.opt_out_capturing()
        pendingResponses[0]({ statusCode: 500 })
        vi.advanceTimersByTime(60_000)

        expect(sentEventNames()).toEqual(['in-flight'])
    })

    it('does not retry a request sent before opting out that fails after opting back in', () => {
        posthog = createPostHog(false)
        posthog.opt_in_capturing({ captureEventName: false })

        const pendingResponses: TransportCallback[] = []
        mockRequest.mockImplementation((_options, onResponse) => pendingResponses.push(onResponse))

        posthog.capture('in-flight')
        posthog.opt_out_capturing()
        posthog.opt_in_capturing({ captureEventName: false })
        pendingResponses[0]({ statusCode: 500 })
        vi.advanceTimersByTime(60_000)

        expect(sentEventNames()).toEqual(['in-flight'])
    })

    it('does not send a failed request already waiting to retry when opting out', () => {
        posthog = createPostHog(false)
        posthog.opt_in_capturing({ captureEventName: false })

        mockRequest.mockImplementationOnce((_options, onResponse) => onResponse({ statusCode: 500 }))
        posthog.capture('awaiting-retry')
        expect(posthog._retryQueue?.length).toBe(1)

        posthog.opt_out_capturing()
        vi.advanceTimersByTime(60_000)

        expect(sentEventNames()).toEqual(['awaiting-retry'])
    })

    it('still retries a failed request while capturing stays opted in', () => {
        posthog = createPostHog(false)
        posthog.opt_in_capturing({ captureEventName: false })

        mockRequest.mockImplementationOnce((_options, onResponse) => onResponse({ statusCode: 500 }))
        posthog.capture('retried')
        vi.advanceTimersByTime(60_000)

        expect(sentEventNames()).toEqual(['retried', 'retried'])
    })

    it('sends events captured after opting back in', () => {
        posthog = createPostHog(true)
        posthog.opt_in_capturing({ captureEventName: false })
        posthog.capture('before-opt-out')
        posthog.opt_out_capturing()

        posthog.opt_in_capturing({ captureEventName: false })
        posthog.capture('after-re-grant')
        vi.advanceTimersByTime(10_000)

        expect(sentEventNames()).toEqual(['after-re-grant'])
    })
})
