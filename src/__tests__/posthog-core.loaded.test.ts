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
                ph._send_request = jest.fn(({ callback }) => callback?.({ status: 200, json: {} }))
                ph._start_queue_if_opted_in = jest.fn()

                jest.spyOn(ph.featureFlags, 'setGroupPropertiesForFlags')
                jest.spyOn(ph.featureFlags, 'setReloadingPaused')
                jest.spyOn(ph.featureFlags, 'reloadFeatureFlags')
                jest.spyOn(ph.featureFlags, '_callDecideEndpoint')

                config?.loaded?.(ph)
            },
        })

        return posthog
    }

    describe('flag reloading', () => {
        it('only calls decide once whilst loading', async () => {
            instance = await createPosthog({
                loaded: (ph) => {
                    ph.group('org', 'bazinga', { name: 'Shelly' })
                },
            })

            expect(instance._send_request).toHaveBeenCalledTimes(1)

            expect(instance._send_request.mock.calls[0][0]).toMatchObject({
                url: 'https://us.i.posthog.com/decide/?v=3',
                data: {
                    groups: { org: 'bazinga' },
                },
            })
            jest.runOnlyPendingTimers() // Once for callback
            jest.runOnlyPendingTimers() // Once for potential debounce
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
            expect(instance.featureFlags._callDecideEndpoint).toHaveBeenCalledTimes(1)
            expect(instance._send_request).toHaveBeenCalledTimes(1)

            expect(instance._send_request.mock.calls[0][0]).toMatchObject({
                url: 'https://us.i.posthog.com/decide/?v=3',
                data: {
                    groups: { org: 'bazinga' },
                },
            })

            jest.runOnlyPendingTimers() // Once for callback
            jest.runOnlyPendingTimers() // Once for potential debounce

            expect(instance.featureFlags._callDecideEndpoint).toHaveBeenCalledTimes(2)
            expect(instance._send_request).toHaveBeenCalledTimes(2)

            expect(instance._send_request.mock.calls[1][0]).toMatchObject({
                url: 'https://us.i.posthog.com/decide/?v=3',
                data: {
                    groups: { org: 'bazinga2' },
                },
            })
        })

        it('does call decide with a request for flags if called directly (via groups) even if disabled for first load', async () => {
            instance = await createPosthog({
                advanced_disable_feature_flags_on_first_load: true,
                loaded: (ph) => {
                    ph.group('org', 'bazinga', { name: 'Shelly' })
                },
            })

            expect(instance.config.advanced_disable_feature_flags_on_first_load).toBe(true)

            expect(instance.featureFlags._callDecideEndpoint).toHaveBeenCalledTimes(1)
            expect(instance._send_request).toHaveBeenCalledTimes(1)

            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toEqual(undefined)

            jest.runOnlyPendingTimers() // Once for callback
            jest.runOnlyPendingTimers() // Once for potential debounce

            expect(instance.featureFlags._callDecideEndpoint).toHaveBeenCalledTimes(1)
            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })
    })

    describe('quota limiting', () => {
        let mockLogger: jest.SpyInstance

        beforeEach(async () => {
            mockLogger = jest.spyOn(console, 'warn').mockImplementation()
            instance = await createPosthog()
        })

        afterEach(() => {
            mockLogger.mockRestore()
        })

        it('does not process feature flags when quota limited', async () => {
            instance._send_request = jest.fn(({ callback }) =>
                callback?.({
                    statusCode: 200,
                    json: {
                        quotaLimited: ['feature_flags'],
                        featureFlags: { 'test-flag': true },
                    },
                })
            )

            const receivedFeatureFlagsSpy = jest.spyOn(instance.featureFlags, 'receivedFeatureFlags')

            instance.featureFlags._callDecideEndpoint()
            jest.runAllTimers()

            expect(receivedFeatureFlagsSpy).not.toHaveBeenCalled()
        })

        it('processes feature flags when not quota limited', async () => {
            const mockFlags = { 'test-flag': true }
            instance._send_request = jest.fn(({ callback }) =>
                callback?.({
                    statusCode: 200,
                    json: {
                        featureFlags: mockFlags,
                    },
                })
            )

            const receivedFeatureFlagsSpy = jest.spyOn(instance.featureFlags, 'receivedFeatureFlags')

            instance.featureFlags._callDecideEndpoint()
            jest.runAllTimers()

            expect(receivedFeatureFlagsSpy).toHaveBeenCalledWith({ featureFlags: mockFlags }, false)
        })

        it('processes feature flags when other resources are quota limited', async () => {
            const mockFlags = { 'test-flag': true }
            instance._send_request = jest.fn(({ callback }) =>
                callback?.({
                    statusCode: 200,
                    json: {
                        quotaLimited: ['recordings'],
                        featureFlags: mockFlags,
                    },
                })
            )

            const receivedFeatureFlagsSpy = jest.spyOn(instance.featureFlags, 'receivedFeatureFlags')

            instance.featureFlags._callDecideEndpoint()
            jest.runAllTimers()

            expect(receivedFeatureFlagsSpy).toHaveBeenCalledWith(
                { quotaLimited: ['recordings'], featureFlags: mockFlags },
                false
            )
        })
    })
})
