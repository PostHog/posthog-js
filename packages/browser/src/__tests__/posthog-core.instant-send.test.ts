import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { PostHog } from '../posthog-core'
import { QueuedRequestWithOptions } from '../types'

const globalsState = vi.hoisted(() => ({ fetch: undefined as any }))

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => {
    const original = await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()
    return {
        ...original,
        get fetch() {
            return globalsState.fetch
        },
    }
})

describe('unbatched capture transport', () => {
    let posthog: PostHog
    let sendRequest: any

    const capturedTransport = (): QueuedRequestWithOptions['transport'] => sendRequest.mock.calls[0][0].transport

    beforeEach(async () => {
        globalsState.fetch = vi.fn()
        posthog = await createPosthogInstance(uuidv7(), { request_batching: true, before_send: (event) => event })
        sendRequest = vi.spyOn(posthog, '_send_request').mockImplementation(() => {})
    })

    it('keeps the default transport while fetch is available', () => {
        posthog.capture('conversion', {}, { send_instantly: true })

        expect(capturedTransport()).toBeUndefined()
    })

    it('uses sendBeacon when fetch is not available', () => {
        globalsState.fetch = undefined

        posthog.capture('conversion', {}, { send_instantly: true })

        expect(capturedTransport()).toBe('sendBeacon')
    })

    it('uses sendBeacon once the page is unloading', () => {
        posthog._handle_unload()
        sendRequest.mockClear()

        posthog.capture('conversion', {}, { send_instantly: true })

        expect(capturedTransport()).toBe('sendBeacon')
    })

    it('returns to the default transport after a back-forward cache restore', () => {
        posthog._handle_unload()
        window.dispatchEvent(new Event('pageshow'))
        sendRequest.mockClear()

        posthog.capture('conversion', {}, { send_instantly: true })

        expect(capturedTransport()).toBeUndefined()
    })

    it('keeps a caller-chosen transport', () => {
        globalsState.fetch = undefined

        posthog.capture('conversion', {}, { send_instantly: true, transport: 'XHR' })

        expect(capturedTransport()).toBe('XHR')
    })

    describe('with request_headers configured', () => {
        beforeEach(async () => {
            posthog = await createPosthogInstance(uuidv7(), {
                request_batching: true,
                before_send: (event) => event,
                request_headers: { 'X-Proxy-Auth': 'proxy-value' },
            })
            sendRequest = vi.spyOn(posthog, '_send_request').mockImplementation(() => {})
        })

        it('keeps the default transport when fetch is not available', () => {
            globalsState.fetch = undefined

            posthog.capture('conversion', {}, { send_instantly: true })

            expect(capturedTransport()).toBeUndefined()
        })

        it('keeps the default transport once the page is unloading', () => {
            posthog._handle_unload()
            sendRequest.mockClear()

            posthog.capture('conversion', {}, { send_instantly: true })

            expect(capturedTransport()).toBeUndefined()
        })
    })

    it('still batches a queued event', () => {
        globalsState.fetch = undefined
        const enqueue = vi.spyOn(posthog._requestQueue as any, 'enqueue').mockImplementation(() => {})

        posthog.capture('page_event')

        expect(enqueue).toHaveBeenCalledTimes(1)
        expect(sendRequest).not.toHaveBeenCalled()
    })
})
