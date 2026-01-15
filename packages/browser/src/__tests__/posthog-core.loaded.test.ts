import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { PostHog } from '../posthog-core'
import { PostHogConfig } from '../types'

jest.useFakeTimers()

describe('loaded() with flags', () => {
    let instance: PostHog

    const createPosthog = async (config?: Partial<PostHogConfig>) => {
        const posthog = await createPosthogInstance(uuidv7(), {
            api_host: 'https://app.posthog.com',
            disable_compression: true,
            ...config,
            loaded: (ph) => {
                ph.capture = jest.fn()
                ph._send_request = jest.fn(({ callback }) => callback?.({ statusCode: 200, json: {} }))
                ph._start_queue_if_opted_in = jest.fn()

                jest.spyOn(ph.featureFlags, 'setGroupPropertiesForFlags')
                jest.spyOn(ph.featureFlags, 'setReloadingPaused')
                jest.spyOn(ph.featureFlags, 'reloadFeatureFlags')
                jest.spyOn(ph.featureFlags, '_callFlagsEndpoint')

                config?.loaded?.(ph)
            },
        })

        return posthog
    }

    describe('replay', () => {
        it('can set force allow localhost network capture', async () => {
            instance = await createPosthog({
                loaded: (ph) => {
                    if (ph.sessionRecording) {
                        ph.sessionRecording._forceAllowLocalhostNetworkCapture = true
                    }
                },
            })

            expect(instance.sessionRecording?._forceAllowLocalhostNetworkCapture).toBe(true)
        })
    })

    describe('flag reloading', () => {
        // Note: With RemoteConfig, there are now 2 flag calls:
        // 1. ensureFlagsLoaded() from RemoteConfig on init
        // 2. reloadFeatureFlags() from group() call
        // The second call includes the group data

        it('only calls flags once whilst loading', async () => {
            instance = await createPosthog({
                loaded: (ph) => {
                    ph.group('org', 'bazinga', { name: 'Shelly' })
                },
            })

            // Run timers to trigger the debounced reloadFeatureFlags
            jest.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)

            expect(instance._send_request.mock.calls[0][0]).toMatchObject({
                url: 'https://us.i.posthog.com/flags/?v=2',
                data: {
                    groups: { org: 'bazinga' },
                },
            })
            jest.runOnlyPendingTimers() // Run any remaining timers
            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('does add follow up call due to group change', async () => {
            instance = await createPosthog({
                loaded: (ph) => {
                    ph.group('org', 'bazinga', { name: 'Shelly' })
                    setTimeout(() => {
                        ph.group('org', 'bazinga2', { name: 'Shelly' })
                    }, 100)
                },
            })

            // Run timers to trigger the first debounced reloadFeatureFlags
            jest.runOnlyPendingTimers()

            expect(instance.featureFlags._callFlagsEndpoint).toHaveBeenCalledTimes(1)
            expect(instance._send_request).toHaveBeenCalledTimes(1)

            expect(instance._send_request.mock.calls[0][0]).toMatchObject({
                url: 'https://us.i.posthog.com/flags/?v=2',
                data: {
                    groups: { org: 'bazinga' },
                },
            })

            jest.runOnlyPendingTimers() // Run the setTimeout for bazinga2
            jest.runOnlyPendingTimers() // Run the debounced reload

            expect(instance.featureFlags._callFlagsEndpoint).toHaveBeenCalledTimes(2)
            expect(instance._send_request).toHaveBeenCalledTimes(2)

            expect(instance._send_request.mock.calls[1][0]).toMatchObject({
                url: 'https://us.i.posthog.com/flags/?v=2',
                data: {
                    groups: { org: 'bazinga2' },
                },
            })
        })

        it('adds only_evaluate_survey_feature_flags query param when configured', async () => {
            instance = await createPosthog({
                advanced_only_evaluate_survey_feature_flags: true,
                loaded: (ph) => {
                    ph.group('org', 'bazinga', { name: 'Shelly' })
                },
            })

            // Run timers to trigger the debounced reloadFeatureFlags
            jest.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0]).toMatchObject({
                url: 'https://us.i.posthog.com/flags/?v=2&only_evaluate_survey_feature_flags=true',
                data: {
                    groups: { org: 'bazinga' },
                },
            })
        })

        it('does call flags with a request for flags if called directly (via groups) even if disabled for first load', async () => {
            instance = await createPosthog({
                advanced_disable_feature_flags_on_first_load: true,
                loaded: (ph) => {
                    ph.group('org', 'bazinga', { name: 'Shelly' })
                },
            })

            expect(instance.config.advanced_disable_feature_flags_on_first_load).toBe(true)

            // Run timers to trigger the debounced reloadFeatureFlags
            jest.runOnlyPendingTimers()

            expect(instance.featureFlags._callFlagsEndpoint).toHaveBeenCalledTimes(1)
            expect(instance._send_request).toHaveBeenCalledTimes(1)

            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toEqual(undefined)

            jest.runOnlyPendingTimers() // Run any remaining timers

            expect(instance.featureFlags._callFlagsEndpoint).toHaveBeenCalledTimes(1)
            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })
    })

    describe('quota limiting', () => {
        beforeEach(async () => {
            instance = await createPosthog()
        })

        it.each([
            {
                name: 'does not process feature flags when quota limited',
                response: {
                    quotaLimited: ['feature_flags'],
                    featureFlags: { 'test-flag': true },
                },
                expectedCall: false,
                expectedArgs: undefined,
            },
            {
                name: 'processes feature flags when not quota limited',
                response: {
                    featureFlags: { 'test-flag': true },
                },
                expectedCall: true,
                expectedArgs: { featureFlags: { 'test-flag': true } },
            },
            {
                name: 'processes feature flags when other resources are quota limited',
                response: {
                    quotaLimited: ['recordings'],
                    featureFlags: { 'test-flag': true },
                },
                expectedCall: true,
                expectedArgs: { quotaLimited: ['recordings'], featureFlags: { 'test-flag': true } },
            },
        ])('$name', async ({ response, expectedCall, expectedArgs }) => {
            instance._send_request = jest.fn(({ callback }) =>
                callback?.({
                    statusCode: 200,
                    json: response,
                })
            )

            const receivedFeatureFlagsSpy = jest.spyOn(instance.featureFlags, 'receivedFeatureFlags')

            instance.featureFlags._callFlagsEndpoint()
            jest.runOnlyPendingTimers()

            if (expectedCall) {
                expect(receivedFeatureFlagsSpy).toHaveBeenCalledWith(expectedArgs, false)
            } else {
                expect(receivedFeatureFlagsSpy).not.toHaveBeenCalled()
            }
        })
    })
})
