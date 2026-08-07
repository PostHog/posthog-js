import { createPosthogInstance } from './helpers/posthog-instance'
import { PostHog } from '../posthog-core'

describe('_captureInitialPageview', () => {
    let posthog: PostHog

    beforeEach(async () => {
        posthog = await createPosthogInstance()
        posthog._initialPageviewCaptured = false
        jest.spyOn(posthog, 'capture')
    })

    afterEach(() => {
        Object.defineProperty(document, 'prerendering', { value: undefined, configurable: true })
    })

    it('captures the pageview immediately for an ordinary hidden/background-tab load', () => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        Object.defineProperty(document, 'prerendering', { value: false, configurable: true })

        posthog._captureInitialPageview()

        expect(posthog.capture).toHaveBeenCalledWith('$pageview', expect.anything(), expect.anything())
    })

    it('defers the pageview while the page is an actual Chrome prerender', () => {
        Object.defineProperty(document, 'prerendering', { value: true, configurable: true })

        posthog._captureInitialPageview()

        expect(posthog.capture).not.toHaveBeenCalled()

        // browser promotes the prerendered page once the user actually navigates to it
        Object.defineProperty(document, 'prerendering', { value: false, configurable: true })
        document.dispatchEvent(new Event('prerenderingchange'))

        expect(posthog.capture).toHaveBeenCalledWith('$pageview', expect.anything(), expect.anything())
    })

    it('only ever captures a single initial pageview', () => {
        Object.defineProperty(document, 'prerendering', { value: false, configurable: true })

        posthog._captureInitialPageview()
        posthog._captureInitialPageview()

        expect(posthog.capture).toHaveBeenCalledTimes(1)
    })
})
