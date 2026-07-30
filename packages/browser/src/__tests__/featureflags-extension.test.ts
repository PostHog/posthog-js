import type { ApiResponse } from '@posthog/browser-common'
import { ENABLED_FEATURE_FLAGS, PERSISTENCE_ACTIVE_FEATURE_FLAGS, STORED_PERSON_PROPERTIES_KEY } from '../constants'
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

    it('reuses cached dynamic event property snapshots until flag state changes', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const registerProperties = jest.spyOn(posthog, '_registerExtensionEventProperties')
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(posthog._getBrowserClientAdapter())
        const producer = registerProperties.mock.calls[0][0]

        const first = producer()
        expect(producer()).toBe(first)
        featureFlags.updateFlags({ changed: true })
        const updated = producer()

        expect(updated).not.toBe(first)
        expect(updated).toMatchObject({ '$feature/changed': true, $active_feature_flags: ['changed'] })

        featureFlags.getFeatureFlag('changed')
        expect(producer()).toBe(updated)
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

    it('lets the latest request supersede an older response', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        let distinctId = 'anonymous-id'
        jest.spyOn(posthog, 'get_distinct_id').mockImplementation(() => distinctId)
        const resolveRequests: Array<(response: ApiResponse) => void> = []
        const sendRequest = jest.spyOn(client, 'sendRequest').mockImplementation(
            () =>
                new Promise<ApiResponse>((resolve) => {
                    resolveRequests.push(resolve)
                })
        )
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(client)

        const firstRequest = featureFlags._callFlagsEndpoint()
        distinctId = 'identified-id'
        featureFlags.setAnonymousDistinctId('anonymous-id')
        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(5)

        expect(sendRequest).toHaveBeenCalledTimes(2)
        expect(sendRequest.mock.calls[1][1]?.body).toMatchObject({
            distinct_id: 'identified-id',
            $anon_distinct_id: 'anonymous-id',
        })

        resolveRequests[1]({ statusCode: 200, json: { featureFlags: { current: true } } })
        await Promise.resolve()
        expect(featureFlags.getFlagVariants()).toEqual({ current: true })

        resolveRequests[0]({ statusCode: 200, json: { featureFlags: { stale: true } } })
        await firstRequest
        expect(featureFlags.getFlagVariants()).toEqual({ current: true })
        featureFlags.dispose()
    })

    it('ignores an in-flight response after reset', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        let resolveRequest: ((response: ApiResponse) => void) | undefined
        jest.spyOn(client, 'sendRequest').mockImplementation(
            () =>
                new Promise<ApiResponse>((resolve) => {
                    resolveRequest = resolve
                })
        )
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(client)

        const request = featureFlags._callFlagsEndpoint()
        featureFlags.reset()
        resolveRequest?.({ statusCode: 200, json: { featureFlags: { stale: true } } })
        await request

        expect(featureFlags.getFlagVariants()).toEqual({})
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

    it('persists early access enrollment coherently before callbacks and capture', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(client)
        const callback = jest.fn()
        featureFlags.addFeatureFlagsHandler(callback)
        const capture = jest.spyOn(posthog, 'capture').mockImplementation()
        const setPersistence = jest.spyOn(client.kv, 'set')

        featureFlags.updateEarlyAccessFeatureEnrollment('test-flag', true)

        expect(featureFlags.getFlagVariants()).toEqual({ 'test-flag': true })
        expect(setPersistence).toHaveBeenCalledTimes(1)
        expect(setPersistence).toHaveBeenCalledWith({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['test-flag'],
            [ENABLED_FEATURE_FLAGS]: { 'test-flag': true },
            [STORED_PERSON_PROPERTIES_KEY]: { '$feature_enrollment/test-flag': true },
        })
        expect(callback).toHaveBeenCalledTimes(1)
        expect(capture).toHaveBeenCalledWith('$feature_enrollment_update', expect.any(Object))
        featureFlags.dispose()
    })

    it('waits for asynchronous persistence initialization before hydrating state', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        posthog.persistence?.register({ [ENABLED_FEATURE_FLAGS]: { initialized: true } })
        const client = posthog._getBrowserClientAdapter()
        let resolveInitialization: (() => void) | undefined
        jest.spyOn(client.kv, 'initialize').mockReturnValue(
            new Promise<void>((resolve) => {
                resolveInitialization = resolve
            })
        )
        const getPersistence = jest.spyOn(client.kv, 'get')
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))

        const setup = featureFlags.setup(client)

        expect(getPersistence).not.toHaveBeenCalled()
        expect(featureFlags.getFlagVariants()).toEqual({})
        resolveInitialization?.()
        await setup

        expect(getPersistence).toHaveBeenCalledWith(ENABLED_FEATURE_FLAGS)
        expect(featureFlags.getFlagVariants()).toEqual({ initialized: true })
        featureFlags.dispose()
    })

    it('does not finish setup after disposal during persistence initialization', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        let resolveInitialization: (() => void) | undefined
        jest.spyOn(client.kv, 'initialize').mockReturnValue(
            new Promise<void>((resolve) => {
                resolveInitialization = resolve
            })
        )
        const registerProperties = jest.spyOn(posthog, '_registerExtensionEventProperties')
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))

        const setup = featureFlags.setup(client)
        featureFlags.dispose()
        resolveInitialization?.()
        await setup

        expect(registerProperties).not.toHaveBeenCalled()
        expect(featureFlags.getFlagVariants()).toEqual({})
    })
})
