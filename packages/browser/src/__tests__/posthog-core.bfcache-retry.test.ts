import type { MockInstance } from 'vitest'
import { PostHog } from '../posthog-core'
import { createPosthogInstance } from './helpers/posthog-instance'

describe('retry connectivity after a bfcache restore', () => {
    let posthog: PostHog
    let online: boolean
    let addedListeners: MockInstance<Parameters<Window['addEventListener']>, void>

    beforeEach(async () => {
        online = true
        vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online)
        addedListeners = vi.spyOn(window, 'addEventListener')
        posthog = await createPosthogInstance(undefined, { request_batching: true })
        vi.useFakeTimers()
        vi.spyOn(Math, 'random').mockReturnValue(0.5)
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(async () => {
        await posthog.shutdown()
        for (const [type, listener, options] of addedListeners.mock.calls) {
            window.removeEventListener(type, listener, options)
        }
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    const restorePage = () => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    }

    const failRequest = () => {
        const sendRequest = vi
            .spyOn(posthog, '_send_request')
            .mockImplementationOnce(({ callback }) => callback?.({ statusCode: 0 }))
            .mockImplementation(({ callback }) => callback?.({ statusCode: 200 }))
        posthog._retryQueue!.retriableRequest({ url: '/e', data: { event: 'conversion' } })
        expect(posthog._retryQueue!.length).toBe(1)
        expect(sendRequest).toHaveBeenCalledTimes(1)
        return sendRequest
    }

    it.each([true, false])('refreshes connectivity changed while cached (initially online: %s)', (initiallyOnline) => {
        online = initiallyOnline
        window.dispatchEvent(new Event(online ? 'online' : 'offline'))
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        online = !initiallyOnline
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))

        const sendRequest = failRequest()
        vi.advanceTimersByTime(6000)

        if (online) {
            expect(sendRequest).toHaveBeenCalledTimes(2)
            expect(posthog._retryQueue!.length).toBe(0)
        } else {
            expect(sendRequest).toHaveBeenCalledTimes(1)
            expect(posthog._retryQueue!.length).toBe(1)
            online = true
            window.dispatchEvent(new Event('online'))
            expect(sendRequest).toHaveBeenCalledTimes(2)
            expect(posthog._retryQueue!.length).toBe(0)
        }
    })

    it('pauses retries offline and resumes online after repeated restores', () => {
        for (let cycle = 0; cycle < 2; cycle++) {
            restorePage()
            const sendRequest = failRequest()
            online = false
            window.dispatchEvent(new Event('offline'))

            vi.advanceTimersByTime(6000)

            expect(sendRequest).toHaveBeenCalledTimes(1)
            expect(posthog._retryQueue!.length).toBe(1)

            online = true
            window.dispatchEvent(new Event('online'))

            expect(sendRequest).toHaveBeenCalledTimes(2)
            expect(posthog._retryQueue!.length).toBe(0)
            sendRequest.mockRestore()
        }
    })

    it('does not duplicate connectivity listeners on repeated pageshow events', () => {
        restorePage()
        const listenerCount = addedListeners.mock.calls.length

        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))

        expect(
            addedListeners.mock.calls.slice(listenerCount).filter(([type]) => type === 'online' || type === 'offline')
        ).toHaveLength(0)
    })

    it('does not reattach connectivity listeners after explicit shutdown', async () => {
        restorePage()
        await posthog.shutdown()
        const listenerCount = addedListeners.mock.calls.length

        restorePage()

        expect(
            addedListeners.mock.calls.slice(listenerCount).filter(([type]) => type === 'online' || type === 'offline')
        ).toHaveLength(0)
    })
})
