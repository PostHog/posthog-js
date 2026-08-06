import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { PostHog } from '../posthog-core'

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
            const callback = jest.fn()

            posthog._send_request({ url: 'https://example.com', batchKey: 'logs', callback })

            expect(callback).not.toHaveBeenCalled()
        })

        it('calls the callback with a 429 when the caller opted in', () => {
            const callback = jest.fn()

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
            const callback = jest.fn()

            posthog._send_request({ url: 'https://example.com', batchKey: 'logs', callback })

            expect(callback).not.toHaveBeenCalled()
        })

        it('calls the callback with a 0 when the caller opted in', () => {
            const callback = jest.fn()

            posthog._send_request({ url: 'https://example.com', batchKey: 'logs', fireCallbackOnDrop: true, callback })

            expect(callback).toHaveBeenCalledTimes(1)
            expect(callback).toHaveBeenCalledWith({ statusCode: 0 })
        })
    })
})
