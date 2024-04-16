/* eslint-disable compat/compat */
/*
 * Test that integration with Segment works as expected. The integration should:
 *
 *   - Set the distinct_id to the user's ID if available.
 *   - Set the distinct_id to the anonymous ID if the user's ID is not available.
 *   - Enrich Segment events with PostHog event properties.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { PostHog } from '../posthog-core'

describe(`Segment integration`, () => {
    let segment: any
    let segmentIntegration: any
    let posthogName: string

    jest.setTimeout(500)

    beforeEach(() => {
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

    it('should call loaded after the segment integration has been set up', async () => {
        const loadPromise = new Promise((resolve) => {
            return new PostHog().init(
                `test-token`,
                {
                    debug: true,
                    persistence: `localStorage`,
                    api_host: `https://test.com`,
                    segment: segment,
                    loaded: resolve,
                },
                posthogName
            )
        })
        expect(segmentIntegration).toBeUndefined()
        await loadPromise
        expect(segmentIntegration).toBeDefined()
    })

    it('should set properties from the segment user', async () => {
        const posthog = await new Promise<PostHog>((resolve) => {
            return new PostHog().init(
                `test-token`,
                {
                    debug: true,
                    persistence: `localStorage`,
                    api_host: `https://test.com`,
                    segment: segment,
                    loaded: resolve,
                },
                posthogName
            )
        })

        expect(posthog.get_distinct_id()).toBe('test-id')
        expect(posthog.get_property('$device_id')).toBe('test-anonymous-id')
    })

    it('should handle the segment user being a promise', async () => {
        segment.user = () =>
            Promise.resolve({
                anonymousId: () => 'test-anonymous-id',
                id: () => 'test-id',
            })

        const posthog = await new Promise<PostHog>((resolve) => {
            return new PostHog().init(
                `test-token`,
                {
                    debug: true,
                    persistence: `localStorage`,
                    api_host: `https://test.com`,
                    segment: segment,
                    loaded: resolve,
                },
                posthogName
            )
        })

        expect(posthog.get_distinct_id()).toBe('test-id')
        expect(posthog.get_property('$device_id')).toBe('test-anonymous-id')
    })
})
