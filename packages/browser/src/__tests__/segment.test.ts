/*
 * Test that integration with Segment works as expected. The integration should:
 *
 *   - Set the distinct_id to the user's ID if available.
 *   - Set the distinct_id to the anonymous ID if the user's ID is not available.
 *   - Enrich Segment events with PostHog event properties.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { USER_STATE } from '../constants'
import { SegmentContext, SegmentPlugin } from '../extensions/segment-integration'
import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { PostHogConfig } from '../types'

jest.mock(
    '@posthog/browser-common/utils/globals',
    () => jest.requireActual('./helpers/snapshot-test-globals').snapshotTestGlobals
)

const initPostHogInAPromise = (
    segment: any,
    posthogName: string,
    config?: Partial<PostHogConfig>
): Promise<PostHog> => {
    return new Promise((resolve) => {
        return new PostHog().init(
            `test-token`,
            {
                persistence: `localStorage`,
                api_host: `https://test.com`,
                segment: segment,
                loaded: resolve,
                disable_surveys: true,
                // want to avoid flags code logging during tests
                advanced_disable_feature_flags: true,
                ...(config || {}),
            },
            posthogName
        )
    })
}

// sometimes flakes because of unexpected console.logs
jest.retryTimes(6)

describe(`Segment integration`, () => {
    let segment: any
    let segmentIntegration: SegmentPlugin
    let posthogName: string

    jest.setTimeout(500)

    beforeEach(() => {
        // Clear localStorage to avoid state leakage between tests
        localStorage.clear()

        assignableWindow._POSTHOG_REMOTE_CONFIG = {
            'test-token': {
                config: {},
                siteApps: [],
            },
        } as any

        // Create something that looks like the Segment Analytics 2.0 API. We
        // could use the actual client, but it's a little more tricky and we'd
        // want to mock out the network requests, for which we don't have a good
        // way to do so at the moment.
        segment = {
            user: () => ({
                anonymousId: () => 'test-anonymous-id',
                id: () => 'test-id',
            }),
            register: (integration: SegmentPlugin) => {
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

        // logging of network requests during init causes this to flake
        console.error = jest.fn()
    })

    it('should call loaded after the segment integration has been set up', async () => {
        const loadPromise = initPostHogInAPromise(segment, posthogName)
        expect(segmentIntegration).toBeUndefined()
        await loadPromise
        expect(segmentIntegration).toBeDefined()
    })

    it('should set properties from the segment user', async () => {
        const posthog = await initPostHogInAPromise(segment, posthogName)

        expect(posthog.get_distinct_id()).toBe('test-id')
        expect(posthog.get_property('$device_id')).toBe('test-anonymous-id')
    })

    it('enriches Segment track events with PostHog properties', async () => {
        // memory persistence without a bootstrap distinctID triggers the volatile-identity init warning;
        // Segment supplies the identity here, so allow that console.warn instead of failing on it.
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
        await initPostHogInAPromise(segment, posthogName, { persistence: 'memory' })
        warnSpy.mockRestore()
        const context = {
            event: {
                event: 'Order Completed',
                userId: 'test-id',
                anonymousId: 'test-anonymous-id',
                properties: {
                    order_id: 'order-123',
                    revenue: 99.5,
                    currency: 'USD',
                },
            },
        } as unknown as SegmentContext

        const enrichedContext = segmentIntegration.track!(context)
        const event = enrichedContext.event
        expect(event.properties).toEqual(
            expect.objectContaining({
                distinct_id: 'test-id',
                $device_id: 'test-anonymous-id',
                $session_id: expect.any(String),
                $window_id: expect.any(String),
                $lib_version: expect.any(String),
                $initialization_time: expect.any(String),
                $insert_id: expect.any(String),
                $raw_user_agent: expect.any(String),
                $sdk_debug_extensions_init_time_ms: expect.any(Number),
                $time: expect.any(Number),
                $timezone: expect.any(String),
                $timezone_offset: expect.any(Number),
            })
        )
        expect({
            ...event,
            properties: {
                ...event.properties,
                $session_id: '<generated-session-id>',
                $window_id: '<generated-window-id>',
                $lib_version: '<sdk-version>',
                $initialization_time: '<initialization-time>',
                $insert_id: '<insert-id>',
                $raw_user_agent: '<user-agent>',
                $sdk_debug_extensions_init_time_ms: '<extension-init-time>',
                $time: '<event-time>',
                $timezone: '<runtime-timezone>',
                $timezone_offset: '<runtime-timezone-offset>',
            },
        }).toMatchSnapshot()
    })

    // FIXME: Flaky test - fails on main branch, see issue tracking test isolation
    it.skip('should handle the segment user being a promise', async () => {
        segment.user = () =>
            Promise.resolve({
                anonymousId: () => 'test-anonymous-id',
                id: () => 'test-id',
            })

        const posthog = await initPostHogInAPromise(segment, posthogName)

        expect(posthog.get_distinct_id()).toBe('test-id')
        expect(posthog.get_property('$device_id')).toBe('test-anonymous-id')
    })

    // FIXME: Flaky test - fails on main branch, see issue tracking test isolation
    it.skip('should handle segment.identify after bootstrap', async () => {
        segment.user = () => ({
            anonymousId: () => 'test-anonymous-id',
            id: () => '',
        })

        const posthog = await initPostHogInAPromise(segment, posthogName, { persistence: 'memory' })

        expect(posthog.get_distinct_id()).not.toEqual('test-id')
        expect(posthog.persistence?.get_property(USER_STATE)).toEqual('anonymous')

        if (segmentIntegration && segmentIntegration.identify) {
            segmentIntegration.identify({
                event: {
                    event: '$identify',
                    userId: 'distinguished user',
                    anonymousId: 'anonymous segment user',
                },
            } as unknown as SegmentContext)

            expect(posthog.get_distinct_id()).toEqual('distinguished user')
            expect(posthog.persistence?.get_property(USER_STATE)).toEqual('identified')
        }
    })
})
