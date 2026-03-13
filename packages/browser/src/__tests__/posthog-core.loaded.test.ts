import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { PostHog } from '../posthog-core'
import { PostHogConfig } from '../types'

vi.useFakeTimers()

describe('loaded() with flags', () => {
    let instance: PostHog

    const createPosthog = async (config?: Partial<PostHogConfig>) => {
        const posthog = await createPosthogInstance(uuidv7(), {
            api_host: 'https://app.posthog.com',
            disable_compression: true,
            ...config,
            loaded: (ph) => {
                ph.capture = vi.fn()
                ph._send_request = vi.fn(({ callback }) => callback?.({ statusCode: 200, json: {} }))
                ph._start_queue_if_opted_in = vi.fn()

                vi.spyOn(ph.featureFlags, 'setGroupPropertiesForFlags')
                vi.spyOn(ph.featureFlags, 'setReloadingPaused')
                vi.spyOn(ph.featureFlags, 'reloadFeatureFlags')
                vi.spyOn(ph.featureFlags, '_callFlagsEndpoint')

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
        // With RemoteConfig, flags are loaded via ensureFlagsLoaded() -> reloadFeatureFlags()
        // which debounces with a 5ms timeout. group() calls also go through reloadFeatureFlags().
        // The debouncer batches these into a single _callFlagsEndpoint call.

        it('only calls flags once whilst loading', async () => {
            instance = await createPosthog({
                loaded: (ph) => {
                    ph.group('org', 'bazinga', { name: 'Shelly' })
                },
            })

            // Advance past the 5ms debounce timer from reloadFeatureFlags
            vi.advanceTimersByTime(10)

            expect(instance._send_request).toHaveBeenCalledTimes(1)

            expect(instance._send_request.mock.calls[0][0]).toMatchObject({
                url: 'https://us.i.posthog.com/flags/?v=2',
                data: {
                    groups: { org: 'bazinga' },
                },
            })
            vi.advanceTimersByTime(10) // Ensure no additional debounce
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

            // Advance past the 5ms debounce timer
            vi.advanceTimersByTime(10)

            expect(instance.featureFlags._callFlagsEndpoint).toHaveBeenCalledTimes(1)
            expect(instance._send_request).toHaveBeenCalledTimes(1)

            expect(instance._send_request.mock.calls[0][0]).toMatchObject({
                url: 'https://us.i.posthog.com/flags/?v=2',
                data: {
                    groups: { org: 'bazinga' },
                },
            })

            vi.advanceTimersByTime(100) // Fire the setTimeout for group change
            vi.advanceTimersByTime(10) // Fire the debounce for the second group call

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

            // Advance past the 5ms debounce timer
            vi.advanceTimersByTime(10)

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0]).toMatchObject({
                url: 'https://us.i.posthog.com/flags/?v=2&only_evaluate_survey_feature_flags=true',
                data: {
                    groups: { org: 'bazinga' },
                },
            })
        })

        it('does not load flags on init when advanced_disable_feature_flags_on_first_load is true, but group() still triggers reload', async () => {
            instance = await createPosthog({
                advanced_disable_feature_flags_on_first_load: true,
                loaded: (ph) => {
                    ph.group('org', 'bazinga', { name: 'Shelly' })
                },
            })

            expect(instance.config.advanced_disable_feature_flags_on_first_load).toBe(true)

            // Advance past the 5ms debounce timer — the group() call still triggers reloadFeatureFlags
            vi.advanceTimersByTime(10)

            expect(instance.featureFlags._callFlagsEndpoint).toHaveBeenCalledTimes(1)
            expect(instance._send_request).toHaveBeenCalledTimes(1)

            // The group() triggered reload doesn't set disable_flags
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toEqual(undefined)

            vi.advanceTimersByTime(10) // Ensure no additional calls
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
            instance._send_request = vi.fn(({ callback }) =>
                callback?.({
                    statusCode: 200,
                    json: response,
                })
            )

            const receivedFeatureFlagsSpy = vi.spyOn(instance.featureFlags, 'receivedFeatureFlags')

            instance.featureFlags._callFlagsEndpoint()
            vi.advanceTimersByTime(10)

            if (expectedCall) {
                expect(receivedFeatureFlagsSpy).toHaveBeenCalledWith(expectedArgs, false)
            } else {
                expect(receivedFeatureFlagsSpy).not.toHaveBeenCalled()
            }
        })
    })
})
