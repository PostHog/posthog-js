/*
 * Test that basic SDK usage (init, capture, etc) does not
 * blow up in non-browser (node.js) envs. These are not
 * tests of server-side capturing functionality (which is
 * currently not supported in the browser lib).
 */

import posthog from '../loader-module'
import sinon from 'sinon'

describe(`Module-based loader in Node env`, () => {
    beforeEach(() => {
        jest.spyOn(posthog, '_send_request').mockReturnValue()
        jest.spyOn(window.console, 'log').mockImplementation()
    })

    it('should load and capture the pageview event', () => {
        const sandbox = sinon.createSandbox()
        let loaded = false
        posthog._originalCapture = posthog.capture
        posthog.capture = sandbox.spy()
        posthog.init(`test-token`, {
            debug: true,
            persistence: `localStorage`,
            api_host: `https://test.com`,
            loaded: function () {
                loaded = true
            },
        })

        expect(posthog.capture.calledOnce).toBe(true)
        const captureArgs = posthog.capture.args[0]
        const event = captureArgs[0]
        expect(event).toBe('$pageview')
        expect(loaded).toBe(true)

        posthog.capture = posthog._originalCapture
        delete posthog._originalCapture
    })

    it(`supports identify()`, () => {
        expect(() => posthog.identify(`Pat`)).not.toThrow()
    })

    it(`supports capture()`, () => {
        expect(() => posthog.capture(`Pat`)).not.toThrow()
    })
})
