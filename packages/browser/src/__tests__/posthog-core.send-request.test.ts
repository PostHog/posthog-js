import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { PostHog } from '../posthog-core'
import { request } from '../request'

vi.mock('../request', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../request')>()),
    request: vi.fn(),
}))

// Guards the `fireCallbackOnDrop` opt-in on `_send_request`. The two early
// returns (client not loaded, server rate limit) drop a request without ever
// calling its callback. The logs pipeline opts in so a drop surfaces as a
// retry instead of a stalled flush; every other caller must keep the existing
// silent-drop behavior.
describe('_send_request fireCallbackOnDrop', () => {
    let posthog: PostHog

    beforeEach(async () => {
        posthog = await createPosthogInstance(uuidv7())
    })

    describe('server rate limited', () => {
        beforeEach(() => {
            posthog.rateLimiter.serverLimits = { logs: new Date().getTime() + 60_000 }
        })

        it('does NOT call the callback for callers that did not opt in', () => {
            const callback = vi.fn()

            posthog._send_request({ url: 'https://example.com', batchKey: 'logs', callback })

            expect(callback).not.toHaveBeenCalled()
        })

        it('calls the callback with a 429 when the caller opted in', () => {
            const callback = vi.fn()

            posthog._send_request({ url: 'https://example.com', batchKey: 'logs', fireCallbackOnDrop: true, callback })

            expect(callback).toHaveBeenCalledTimes(1)
            expect(callback).toHaveBeenCalledWith({ statusCode: 429 })
        })
    })

    describe('client not loaded', () => {
        beforeEach(() => {
            ;(posthog as any).__loaded = false
        })

        it('does NOT call the callback for callers that did not opt in', () => {
            const callback = vi.fn()

            posthog._send_request({ url: 'https://example.com', batchKey: 'logs', callback })

            expect(callback).not.toHaveBeenCalled()
        })

        it('calls the callback with a 0 when the caller opted in', () => {
            const callback = vi.fn()

            posthog._send_request({ url: 'https://example.com', batchKey: 'logs', fireCallbackOnDrop: true, callback })

            expect(callback).toHaveBeenCalledTimes(1)
            expect(callback).toHaveBeenCalledWith({ statusCode: 0 })
        })
    })
})

describe('_send_request onDispatch', () => {
    let posthog: PostHog

    beforeEach(async () => {
        posthog = await createPosthogInstance(uuidv7())
        vi.mocked(request).mockClear()
    })

    it('calls onDispatch once, before the transport sends the request', () => {
        const onDispatch = vi.fn()

        posthog._send_request({ url: 'https://example.com', onDispatch })

        expect(onDispatch).toHaveBeenCalledTimes(1)
        expect(request).toHaveBeenCalledTimes(1)
        expect(onDispatch.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(request).mock.invocationCallOrder[0])
    })

    it.each([
        [
            'the client is not loaded',
            (posthog: PostHog) => {
                ;(posthog as any).__loaded = false
            },
        ],
        [
            'the server rate limits the request',
            (posthog: PostHog) => {
                posthog.rateLimiter.serverLimits = { events: new Date().getTime() + 60_000 }
            },
        ],
    ])('does not call onDispatch when %s', (_name, drop) => {
        drop(posthog)
        const onDispatch = vi.fn()
        const callback = vi.fn()

        posthog._send_request({ url: 'https://example.com', fireCallbackOnDrop: true, onDispatch, callback })

        expect(callback).toHaveBeenCalledTimes(1)
        expect(onDispatch).not.toHaveBeenCalled()
        expect(request).not.toHaveBeenCalled()
    })
})
