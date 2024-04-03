/*
 * Test that basic SDK usage (init, capture, etc) does not
 * blow up in non-browser (node.js) envs. These are not
 * tests of server-side capturing functionality (which is
 * currently not supported in the browser lib).
 */

import posthog from '../loader-module'
import { window } from '../utils/globals'

describe(`Module-based loader in Node env`, () => {
    beforeEach(() => {
        jest.useFakeTimers()
        // jest.spyOn(posthog, '_send_request').mockReturnValue()
        jest.spyOn(window!.console, 'log').mockImplementation()
    })

    it('should load and capture the pageview event', () => {
        posthog.init(`test-token`, {
            debug: true,
            opt_out_capturing_by_default: true,
            opt_out_persistence_by_default: true,
            api_host: `https://test.com`,
        })
        // posthog.opt_in_capturing({
        //     enable_persistence: true,
        // })
        posthog.opt_in_capturing()

        jest.runOnlyPendingTimers()
    })
})
