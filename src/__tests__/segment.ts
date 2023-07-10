/* eslint-disable compat/compat */
/*
 * Test that integration with Segment works as expected. The integration should:
 *
 *   - Set the distinct_id to the user's ID if available.
 *   - Set the distinct_id to the anonymous ID if the user's ID is not available.
 *   - Enrich Segment events with PostHog event properties.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

import posthog from '../loader-module'
import { PostHog } from '../posthog-core'
import { _UUID } from '../utils'

describe(`Module-based loader in Node env`, () => {
    let segment: any
    let segmentIntegration: any
    let posthogName: string

    beforeEach(() => {
        jest.spyOn(posthog, '_send_request').mockReturnValue()
        jest.spyOn(console, 'log').mockReturnValue()
        posthogName = _UUID('v7')

        // Create something that looks like the Segment Analytics 2.0 API. We
        // could use the actual client, but it's a little more tricky and we'd
        // want to mock out the network requests, for which we don't have a good
        // way to do so at the moment.
        segment = {
            user: () => ({
                anonymousId: () => 'test-anonymous-id',
                id: () => 'test-id',
            }),
            register: (integration: any) => {
                // IMPORTANT: the real register function returns a Promise. We
                // want to do the same thing and have some way to verify that
                // the integration is setup in time for the `loaded` callback.
                // To ensure the Promise isn't resolved instantly, we use a
                // setTimeout with a delay of 0 to ensure it happens as a
                // microtask in the future.
                return new Promise((resolve) => {
                    setTimeout(() => {
                        segmentIntegration = integration
                        resolve(integration)
                    }, 0)
                })
            },
        }
    })

    it('should call loaded after the segment integration has been set up', (done) => {
        // This test is to ensure that, by the time the `loaded` callback is
        // called, the PostHog Segment integration have completed registration.
        // If this is not the case, then we end up in odd situations where we
        // try to send segment events but we do not get the enriched event
        // information as the integration provides.
        const posthog = new PostHog()
        jest.spyOn(posthog, 'capture')

        posthog.init(
            `test-token`,
            {
                debug: true,
                persistence: `localStorage`,
                api_host: `https://test.com`,
                segment: segment,
                loaded: () => {
                    expect(segmentIntegration).toBeDefined()
                    done()
                },
            },
            posthogName
        )

        // Assuming we've set up our mocks correctly, the segmentIntegration
        // shouldn't have been set by now, but just to be sure we're actually
        // checking that loaded callback handles async code, we explicitly check
        // this first.
        expect(segmentIntegration).toBeUndefined()
    })

    // TODO: add tests for distinct id setting and event enrichment.
})
