import { ENABLED_FEATURE_FLAGS, PERSISTENCE_ACTIVE_FEATURE_FLAGS } from '../constants'
import { MutableFeatureFlagsConfigSource } from '../feature-flags-config'
import { defaultConfig } from '../posthog-core'
import { PostHogFeatureFlags } from '../posthog-featureflags'
import { createPosthogInstance } from './helpers/posthog-instance'

describe('PostHogFeatureFlags extension lifecycle', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    it('has a side-effect-free constructor and disposes setup listeners idempotently', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const addListener = jest.spyOn(window, 'addEventListener')
        const removeListener = jest.spyOn(window, 'removeEventListener')
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))

        expect(addListener).not.toHaveBeenCalled()
        featureFlags.setup(posthog._getBrowserClientAdapter())
        expect(addListener).toHaveBeenCalledWith('online', expect.any(Function), { capture: false, passive: true })

        featureFlags.dispose()
        featureFlags.dispose()
        expect(removeListener).toHaveBeenCalledTimes(1)
        expect(removeListener).toHaveBeenCalledWith('online', expect.any(Function))
    })

    it('does not send a debounced request after reset', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        const sendRequest = jest.spyOn(client, 'sendRequest')
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(client)

        featureFlags.reloadFeatureFlags()
        featureFlags.reset()
        jest.advanceTimersByTime(10)

        expect(sendRequest).not.toHaveBeenCalled()
        featureFlags.dispose()
    })


    it('uses flags transport semantics and semantic request configuration', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        const sendRequest = jest.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json: {} })
        const config = defaultConfig()
        config.advanced_only_evaluate_survey_feature_flags = true
        config.evaluation_contexts = ['production']
        config.flag_keys = ['survey-flag']
        config.feature_flag_request_timeout_ms = 1234
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(config))
        featureFlags.setup(client)

        featureFlags._callFlagsEndpoint()

        expect(sendRequest).toHaveBeenCalledWith(
            '/flags/?v=2&only_evaluate_survey_feature_flags=true',
            expect.objectContaining({
                target: 'flags',
                method: 'POST',
                compression: 'base64',
                sentAt: 'body',
                timeoutMs: 1234,
                body: expect.objectContaining({
                    evaluation_contexts: ['production'],
                    flag_keys: ['survey-flag'],
                }),
            })
        )
        featureFlags.dispose()
    })

    it('hydrates browser-v1 persistence synchronously', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        posthog.persistence?.register({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['cached-flag'],
            [ENABLED_FEATURE_FLAGS]: { 'cached-flag': 'control' },
        })
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))

        const setup = featureFlags.setup(posthog._getBrowserClientAdapter())

        expect(setup).toBeUndefined()
        expect(featureFlags.getFlagVariants()).toEqual({ 'cached-flag': 'control' })
        featureFlags.dispose()
    })

    it('runs persistence continuations in the same tick for browser-v1', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(posthog._getBrowserClientAdapter())
        const callback = jest.fn()
        featureFlags.addFeatureFlagsHandler(callback)
        jest.spyOn(console, 'log').mockImplementation()

        featureFlags.receivedFeatureFlags({ featureFlags: { 'test-flag': true } })
        expect(callback).toHaveBeenCalledTimes(1)

        callback.mockClear()
        featureFlags.overrideFeatureFlags({ flags: { 'test-flag': false }, suppressWarning: true })
        expect(callback).toHaveBeenCalledTimes(1)
        expect(featureFlags.getFeatureFlag('test-flag', { send_event: false })).toBe(false)

        const capture = jest.spyOn(posthog, 'capture')
        featureFlags.getFeatureFlag('test-flag')
        expect(capture).toHaveBeenCalledWith('$feature_flag_called', expect.any(Object))

        const reload = jest.spyOn(featureFlags, 'reloadFeatureFlags')
        featureFlags.setPersonPropertiesForFlags({ plan: 'pro' })
        featureFlags.setGroupPropertiesForFlags({ company: { plan: 'pro' } })
        expect(reload).toHaveBeenCalledTimes(2)

        capture.mockClear()
        featureFlags.updateEarlyAccessFeatureEnrollment('test-flag', true)
        expect(capture).toHaveBeenCalledWith('$feature_enrollment_update', expect.any(Object))
        featureFlags.dispose()
    })

    it('waits for asynchronous persistence before running continuations', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(client)
        featureFlags.receivedFeatureFlags({ featureFlags: { 'test-flag': true } })
        const callback = jest.fn()
        featureFlags.addFeatureFlagsHandler(callback)
        jest.spyOn(console, 'log').mockImplementation()
        let resolvePersistence: (() => void) | undefined
        jest.spyOn(client.kv, 'set').mockReturnValue(
            new Promise<void>((resolve) => {
                resolvePersistence = resolve
            })
        )

        featureFlags.overrideFeatureFlags({ flags: { 'test-flag': false }, suppressWarning: true })

        expect(featureFlags.getFeatureFlag('test-flag', { send_event: false })).toBe(false)
        expect(callback).not.toHaveBeenCalled()
        resolvePersistence?.()
        for (let i = 0; i < 5; i++) {
            await Promise.resolve()
        }
        expect(callback).toHaveBeenCalledTimes(1)
        featureFlags.dispose()
    })
})
