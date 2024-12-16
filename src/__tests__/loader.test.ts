/*
 * Test that basic SDK usage (init, capture, etc) does not
 * blow up in non-browser (node.js) envs. These are not
 * tests of server-side capturing functionality (which is
 * currently not supported in the browser lib).
 */

import { PostHog } from '../posthog-core'
import { defaultPostHog } from './helpers/posthog-instance'

import sinon from 'sinon'
import { window } from '../utils/globals'

describe(`Module-based loader in Node env`, () => {
    const posthog = defaultPostHog()

    beforeEach(() => {
        jest.useFakeTimers()
        jest.spyOn(posthog, '_send_request').mockReturnValue()
        jest.spyOn(window!.console, 'log').mockImplementation()
    })

    it('should load and capture the pageview event', () => {
        const sandbox = sinon.createSandbox()
        let loaded = false
        const _originalCapture = posthog.capture
        posthog.capture = sandbox.spy()
        posthog.init(`test-token`, {
            debug: true,
            persistence: `localStorage`,
            api_host: `https://test.com`,
            loaded: function () {
                loaded = true
            },
        })

        jest.runOnlyPendingTimers()

        sinon.assert.calledOnce(posthog.capture as sinon.SinonSpy<any>)
        const captureArgs = (posthog.capture as sinon.SinonSpy<any>).args[0]
        const event = captureArgs[0]
        expect(event).toBe('$pageview')
        expect(loaded).toBe(true)

        posthog.capture = _originalCapture
    })

    it(`supports identify()`, () => {
        expect(() => posthog.identify(`Pat`)).not.toThrow()
    })

    it(`supports capture()`, () => {
        expect(() => posthog.capture(`Pat`)).not.toThrow()
    })

    it(`always returns posthog from init`, () => {
        console.error = jest.fn()
        console.warn = jest.fn()
        expect(posthog.init(`my-test`, undefined, 'sdk-1')).toBeInstanceOf(PostHog)
        expect(posthog.init(``, undefined, 'sdk-2')).toBeInstanceOf(PostHog)
        expect(console.error).toHaveBeenCalledTimes(1)
        expect(console.error).toHaveBeenCalledWith(
            '[PostHog.js]',
            'PostHog was initialized without a token. This likely indicates a misconfiguration. Please check the first argument passed to posthog.init()'
        )
        // Already loaded
        expect(posthog.init(`my-test`, undefined, 'sdk-1')).toBeInstanceOf(PostHog)
        expect(console.warn).toHaveBeenCalledWith(
            '[PostHog.js]',
            'You have already initialized PostHog! Re-initializing is a no-op'
        )
    })
})
