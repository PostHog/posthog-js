import {
    ENABLED_FEATURE_FLAGS,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
    PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS,
    STORED_PERSON_PROPERTIES_KEY,
} from '../constants'
import { MutableFeatureFlagsConfigSource } from '../feature-flags-config'
import { defaultConfig } from '../posthog-core'
import { PostHogFeatureFlags } from '../posthog-featureflags'
import { PostHogFeatureFlags as SharedFeatureFlags } from '@posthog/browser-common/feature-flags'
import { PostHogPersistence } from '../posthog-persistence'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'

describe('PostHogFeatureFlags extension lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('looks up legacy persistence at setup and marks enrollment ownership before writing KV', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const flags = new PostHogFeatureFlags(posthog)
        const originalPersistence = posthog.persistence
        const persistence = new PostHogPersistence(posthog.config)
        posthog.persistence = persistence
        const unsubscribe = vi.fn()
        const subscribe = vi.spyOn(persistence, 'onCrossTabFeatureFlagChange').mockReturnValue(unsubscribe)
        const markChanges = vi.spyOn(persistence, 'markCrossTabFeatureFlagChanges')
        const client = posthog._getBrowserClientAdapter()
        const write = vi.spyOn(client.kv, 'set')

        flags.setup(client)
        flags.updateEarlyAccessFeatureEnrollment('flag', true)

        expect(subscribe).toHaveBeenCalledTimes(1)
        expect(subscribe.mock.instances[0]).toBe(persistence)
        expect(markChanges).toHaveBeenCalledWith({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['flag'],
            [ENABLED_FEATURE_FLAGS]: ['flag'],
            [STORED_PERSON_PROPERTIES_KEY]: ['$feature_enrollment/flag'],
        })
        expect(markChanges.mock.instances[0]).toBe(persistence)
        expect(markChanges.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0])
        flags.dispose()
        flags.dispose()
        expect(unsubscribe).toHaveBeenCalledTimes(1)

        posthog.persistence = originalPersistence
        persistence.destroy()
        await posthog.shutdown()
    })

    it('notifies feature flag handlers when a sibling tab updates enrollment state', async () => {
        const token = uuidv7()
        const persistenceName = `cross-tab-flags-${token}`
        const posthog = await createPosthogInstance(token, {
            advanced_disable_feature_flags: true,
            persistence: 'localStorage',
            persistence_name: persistenceName,
            persistence_save_debounce_ms: 0,
        })
        posthog.persistence?.register({ [ENABLED_FEATURE_FLAGS]: { 'early-access-flag': false } })
        const siblingPersistence = new PostHogPersistence(posthog.config)
        const callback = vi.fn()
        posthog.onFeatureFlags(callback)
        const storageKey = `ph_${persistenceName}`
        const oldValue = window.localStorage.getItem(storageKey)

        siblingPersistence.register({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['early-access-flag'],
            [ENABLED_FEATURE_FLAGS]: { 'early-access-flag': true },
            [PERSISTENCE_FEATURE_FLAG_DETAILS]: {
                'early-access-flag': {
                    key: 'early-access-flag',
                    enabled: true,
                    reason: { code: 'condition_match', description: 'Fresh sibling evaluation' },
                    metadata: { id: 2, version: 3 },
                },
            },
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { 'early-access-flag': { source: 'fresh-sibling' } },
            [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: 'fresh-request',
            [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: 200,
            [PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS]: false,
            [STORED_PERSON_PROPERTIES_KEY]: { '$feature_enrollment/early-access-flag': true },
        })
        const newValue = window.localStorage.getItem(storageKey)
        window.dispatchEvent(new StorageEvent('storage', { key: storageKey, oldValue, newValue }))

        expect(posthog.isFeatureEnabled('early-access-flag', { send_event: false })).toBe(true)
        expect(posthog.featureFlags?.['_eventPropertiesWithFlagValues']).toMatchObject({
            '$feature/early-access-flag': true,
        })
        expect(callback).toHaveBeenCalledWith(
            ['early-access-flag'],
            { 'early-access-flag': true },
            { errorsLoading: undefined }
        )
        const capture = vi.spyOn(posthog, 'capture').mockImplementation(() => {})
        posthog.getFeatureFlag('early-access-flag')
        expect(capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag_response: true,
                $feature_flag_payload: { source: 'fresh-sibling' },
                $feature_flag_request_id: 'fresh-request',
                $feature_flag_evaluated_at: 200,
                $feature_flag_version: 3,
                $feature_flag_reason: 'Fresh sibling evaluation',
                $feature_flag_id: 2,
            })
        )

        siblingPersistence.destroy()
        await posthog.shutdown()
    })

    it('replaces bootstrap flags when a sibling tab persists a fresh snapshot', async () => {
        const token = uuidv7()
        const persistenceName = `cross-tab-bootstrap-${token}`
        const posthog = await createPosthogInstance(token, {
            advanced_disable_feature_flags: true,
            persistence: 'localStorage',
            persistence_name: persistenceName,
            persistence_save_debounce_ms: 0,
            bootstrap: {
                featureFlags: { flag: 'bootstrap' },
                featureFlagPayloads: { flag: { source: 'bootstrap' } },
            },
        })
        const siblingPersistence = new PostHogPersistence(posthog.config)
        const callback = vi.fn()
        posthog.onFeatureFlags(callback)
        callback.mockClear()
        const storageKey = `ph_${persistenceName}`
        const oldValue = window.localStorage.getItem(storageKey)

        siblingPersistence.register({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['flag'],
            [ENABLED_FEATURE_FLAGS]: { flag: 'fresh-sibling' },
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { flag: { source: 'fresh-sibling' } },
        })
        const newValue = window.localStorage.getItem(storageKey)
        window.dispatchEvent(new StorageEvent('storage', { key: storageKey, oldValue, newValue }))

        expect(posthog.getFeatureFlag('flag', { send_event: false })).toBe('fresh-sibling')
        expect(posthog.getFeatureFlagPayload('flag')).toEqual({ source: 'fresh-sibling' })
        expect(callback).toHaveBeenCalledWith(['flag'], { flag: 'fresh-sibling' }, { errorsLoading: undefined })

        siblingPersistence.destroy()
        await posthog.shutdown()
    })

    it('preserves an explicit enrollment update when sibling state has not been observed yet', async () => {
        const token = uuidv7()
        const persistenceName = `cross-tab-enrollment-${token}`
        const posthog = await createPosthogInstance(token, {
            advanced_disable_feature_flags: true,
            persistence: 'localStorage',
            persistence_name: persistenceName,
            persistence_save_debounce_ms: 0,
        })
        posthog.persistence?.register({ [ENABLED_FEATURE_FLAGS]: { 'early-access-flag': false } })
        const siblingPersistence = new PostHogPersistence(posthog.config)
        siblingPersistence.register({ [ENABLED_FEATURE_FLAGS]: { 'early-access-flag': true } })

        posthog.updateEarlyAccessFeatureEnrollment('early-access-flag', false)

        expect(posthog.isFeatureEnabled('early-access-flag', { send_event: false })).toBe(false)
        expect(JSON.parse(window.localStorage.getItem(`ph_${persistenceName}`) || '{}')[ENABLED_FEATURE_FLAGS]).toEqual(
            { 'early-access-flag': false }
        )
        siblingPersistence.destroy()
        await posthog.shutdown()
    })

    it('preserves a same-value authoritative flag snapshot over unseen sibling state', async () => {
        const token = uuidv7()
        const persistenceName = `cross-tab-snapshot-${token}`
        const posthog = await createPosthogInstance(token, {
            advanced_disable_feature_flags: true,
            persistence: 'localStorage',
            persistence_name: persistenceName,
            persistence_save_debounce_ms: 0,
        })
        posthog.persistence?.register({ [ENABLED_FEATURE_FLAGS]: { flag: false } })
        const siblingPersistence = new PostHogPersistence(posthog.config)
        siblingPersistence.register({ [ENABLED_FEATURE_FLAGS]: { flag: true } })

        posthog.featureFlags?.receivedFeatureFlags({ featureFlags: { flag: false } })

        expect(posthog.isFeatureEnabled('flag', { send_event: false })).toBe(false)
        expect(JSON.parse(window.localStorage.getItem(`ph_${persistenceName}`) || '{}')[ENABLED_FEATURE_FLAGS]).toEqual(
            { flag: false }
        )
        siblingPersistence.destroy()
        await posthog.shutdown()
    })

    it('removes unseen sibling flags after an authoritative full evaluation', async () => {
        const token = uuidv7()
        const persistenceName = `cross-tab-full-snapshot-${token}`
        const posthog = await createPosthogInstance(token, {
            advanced_disable_feature_flags: true,
            persistence: 'localStorage',
            persistence_name: persistenceName,
            persistence_save_debounce_ms: 0,
        })
        const siblingPersistence = new PostHogPersistence(posthog.config)
        siblingPersistence.register({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['unseen-flag'],
            [ENABLED_FEATURE_FLAGS]: { 'unseen-flag': true },
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { 'unseen-flag': { source: 'sibling' } },
            [PERSISTENCE_FEATURE_FLAG_DETAILS]: {
                'unseen-flag': { key: 'unseen-flag', enabled: true, metadata: { id: 1, version: 1 } },
            },
        })

        posthog.featureFlags?.receivedFeatureFlags({ flags: {} })

        const stored = JSON.parse(window.localStorage.getItem(`ph_${persistenceName}`) || '{}')
        expect(stored[PERSISTENCE_ACTIVE_FEATURE_FLAGS]).toEqual([])
        expect(stored[ENABLED_FEATURE_FLAGS]).toEqual({})
        expect(stored[PERSISTENCE_FEATURE_FLAG_PAYLOADS]).toEqual({})
        expect(stored[PERSISTENCE_FEATURE_FLAG_DETAILS]).toEqual({})
        siblingPersistence.destroy()
        await posthog.shutdown()
    })

    it('does not overwrite sibling state with a retained failed evaluation', async () => {
        const token = uuidv7()
        const persistenceName = `cross-tab-failed-evaluation-${token}`
        const posthog = await createPosthogInstance(token, {
            advanced_disable_feature_flags: true,
            persistence: 'localStorage',
            persistence_name: persistenceName,
            persistence_save_debounce_ms: 0,
        })
        posthog.persistence?.register({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: [],
            [ENABLED_FEATURE_FLAGS]: { flag: false },
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { flag: { source: 'stale-cache' } },
            [PERSISTENCE_FEATURE_FLAG_DETAILS]: {
                flag: { key: 'flag', enabled: false, metadata: { id: 1, version: 1 } },
            },
        })
        const siblingPersistence = new PostHogPersistence(posthog.config)
        siblingPersistence.register({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['flag'],
            [ENABLED_FEATURE_FLAGS]: { flag: true },
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { flag: { source: 'fresh-sibling' } },
            [PERSISTENCE_FEATURE_FLAG_DETAILS]: {
                flag: { key: 'flag', enabled: true, metadata: { id: 2, version: 2 } },
            },
        })

        posthog.featureFlags?.receivedFeatureFlags({
            flags: {
                flag: {
                    key: 'flag',
                    enabled: false,
                    failed: true,
                    metadata: { id: 3, version: 3 },
                },
            },
            errorsWhileComputingFlags: true,
            requestId: 'failed-request',
        })

        expect(posthog.isFeatureEnabled('flag', { send_event: false })).toBe(true)
        expect(posthog.persistence?.get_property(PERSISTENCE_FEATURE_FLAG_PAYLOADS)).toEqual({
            flag: { source: 'fresh-sibling' },
        })
        expect(posthog.persistence?.get_property(PERSISTENCE_FEATURE_FLAG_DETAILS)).toEqual({
            flag: { key: 'flag', enabled: true, metadata: { id: 2, version: 2 } },
        })
        siblingPersistence.destroy()
        await posthog.shutdown()
    })
    describe('automatic refresh', () => {
        const refreshIntervalMs = 60_000
        const defaultRefreshIntervalMs = 5 * 60_000
        let featureFlags: PostHogFeatureFlags | undefined

        const setVisibilityState = (state: DocumentVisibilityState): void => {
            Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
        }

        const setupFeatureFlags = async (interval?: number): Promise<PostHogFeatureFlags> => {
            const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
            const config = defaultConfig()
            config.remote_config_refresh_interval_ms = interval
            featureFlags = new PostHogFeatureFlags(posthog)
            featureFlags.updateConfig(config, false)
            await featureFlags.setup(posthog._getBrowserClientAdapter())
            return featureFlags
        }

        beforeEach(() => {
            setVisibilityState('visible')
        })

        afterEach(() => {
            featureFlags?.dispose()
            featureFlags = undefined
            setVisibilityState('visible')
        })

        it('starts only after remote requests are enabled', async () => {
            const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
            const config = defaultConfig()
            config.remote_config_refresh_interval_ms = refreshIntervalMs
            featureFlags = new PostHogFeatureFlags(posthog)
            featureFlags.updateConfig(config, true)
            const addDocumentListener = vi.spyOn(document, 'addEventListener')

            await featureFlags.setup(posthog._getBrowserClientAdapter())

            expect(featureFlags['_refreshInterval']).toBeUndefined()
            expect(addDocumentListener).not.toHaveBeenCalledWith(
                'visibilitychange',
                expect.any(Function),
                expect.anything()
            )

            featureFlags.updateConfig(config, false)

            expect(featureFlags['_refreshInterval']).toBeDefined()
            expect(addDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function), {
                capture: false,
                passive: true,
            })
        })

        it('uses the existing five-minute default when the public option is undefined', async () => {
            const featureFlags = await setupFeatureFlags()
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(defaultRefreshIntervalMs - 1)
            expect(reloadFeatureFlags).not.toHaveBeenCalled()
            vi.advanceTimersByTime(1)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })

        it('switches from implicit backoff to an explicit interval with the same value', async () => {
            const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
            featureFlags = posthog.featureFlags
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(defaultRefreshIntervalMs * 3)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(2)

            posthog.set_config({ remote_config_refresh_interval_ms: defaultRefreshIntervalMs })
            vi.advanceTimersByTime(defaultRefreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(3)
            vi.advanceTimersByTime(defaultRefreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(4)

            await posthog.shutdown()
        })

        it('applies an interval configured from the loaded callback', async () => {
            const posthog = await createPosthogInstance(undefined, {
                advanced_disable_feature_flags: true,
                loaded: (instance) => instance.set_config({ remote_config_refresh_interval_ms: refreshIntervalMs }),
            })
            featureFlags = posthog.featureFlags
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(refreshIntervalMs)

            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
            await posthog.shutdown()
        })

        it('enables, restarts, or stops automatic refresh when public config changes', async () => {
            const posthog = await createPosthogInstance(undefined, {
                advanced_disable_feature_flags: true,
                remote_config_refresh_interval_ms: 0,
            })
            featureFlags = posthog.featureFlags
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(defaultRefreshIntervalMs)
            expect(reloadFeatureFlags).not.toHaveBeenCalled()

            posthog.set_config({ remote_config_refresh_interval_ms: refreshIntervalMs })
            vi.advanceTimersByTime(refreshIntervalMs / 2)
            posthog.set_config({ remote_config_refresh_interval_ms: refreshIntervalMs * 2 })

            vi.advanceTimersByTime(refreshIntervalMs * 2 - 1)
            expect(reloadFeatureFlags).not.toHaveBeenCalled()
            vi.advanceTimersByTime(1)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)

            posthog.set_config({ remote_config_refresh_interval_ms: 0 })
            vi.advanceTimersByTime(refreshIntervalMs * 2)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
            await posthog.shutdown()
        })

        it('uses the latest interval when asynchronous setup completes', async () => {
            const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
            const client = posthog._getBrowserClientAdapter()
            let resolveInitialization: (() => void) | undefined
            vi.spyOn(client.kv, 'initialize').mockReturnValue(
                new Promise<void>((resolve) => {
                    resolveInitialization = resolve
                })
            )
            featureFlags = new PostHogFeatureFlags(posthog)
            const setup = featureFlags.setup(client)
            const config = defaultConfig()
            config.remote_config_refresh_interval_ms = refreshIntervalMs
            featureFlags.updateConfig(config, false)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            resolveInitialization?.()
            await setup
            vi.advanceTimersByTime(refreshIntervalMs)

            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })

        it('stops automatic refresh through the legacy destroy method', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            featureFlags.destroy()
            const config = defaultConfig()
            config.remote_config_refresh_interval_ms = refreshIntervalMs
            featureFlags.updateConfig(config, false)
            vi.advanceTimersByTime(refreshIntervalMs)
            document.dispatchEvent(new Event('visibilitychange'))

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('does not start automatic refresh when destroyed during asynchronous setup', async () => {
            const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
            const client = posthog._getBrowserClientAdapter()
            let resolveInitialization: (() => void) | undefined
            vi.spyOn(client.kv, 'initialize').mockReturnValue(
                new Promise<void>((resolve) => {
                    resolveInitialization = resolve
                })
            )
            featureFlags = new PostHogFeatureFlags(posthog)
            const config = defaultConfig()
            config.remote_config_refresh_interval_ms = refreshIntervalMs
            featureFlags.updateConfig(config, false)
            const setup = featureFlags.setup(client)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            featureFlags.destroy()
            resolveInitialization?.()
            await setup
            vi.advanceTimersByTime(refreshIntervalMs)

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })
    })

    it('propagates set_config updates to the enrolled feature flags extension', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const sendRequest = vi
            .spyOn(posthog._getBrowserClientAdapter(), 'sendRequest')
            .mockResolvedValue({ statusCode: 200, json: {} })

        posthog.set_config({
            advanced_disable_feature_flags: false,
            evaluation_contexts: ['updated-context'],
        })
        posthog.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(5)

        expect(sendRequest).toHaveBeenCalledWith(
            '/flags/?v=2',
            expect.objectContaining({
                body: expect.objectContaining({ evaluation_contexts: ['updated-context'] }),
            })
        )
    })

    it('enriches ordinary capture and direct calculation without enriching snapshots', async () => {
        const posthog = await createPosthogInstance(undefined, {
            advanced_disable_feature_flags: true,
            request_batching: true,
            before_send: (event) => event,
        })
        const featureFlags = new SharedFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        await featureFlags.setup(posthog._getBrowserClientAdapter())
        posthog.persistence?.register({
            $feature_flag_request_id: 'request-id',
            $override_feature_flags: { overridden: true },
        })
        featureFlags.updateFlags(
            { active: true, variant: 'control' },
            { active: { configured: true }, variant: 'payload' }
        )

        const enqueue = vi.spyOn(posthog._requestQueue!, 'enqueue')
        posthog.capture('$snapshot', { explicitly_supplied: 'snapshot-value' })
        posthog.capture('ordinary-event')

        expect(enqueue).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                data: expect.objectContaining({
                    event: '$snapshot',
                    properties: expect.objectContaining({ explicitly_supplied: 'snapshot-value' }),
                }),
            })
        )
        const snapshotProperties = enqueue.mock.calls[0][0].data.properties
        for (const property of [
            '$active_feature_flags',
            '$feature_flag_payloads',
            '$feature_flag_request_id',
            '$override_feature_flags',
            '$feature/active',
            '$feature/variant',
        ]) {
            expect(snapshotProperties).not.toHaveProperty(property)
        }

        expect(enqueue).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                data: expect.objectContaining({
                    event: 'ordinary-event',
                    properties: expect.objectContaining({
                        $active_feature_flags: ['active', 'variant'],
                        $feature_flag_payloads: {
                            active: { configured: true },
                            variant: 'payload',
                        },
                        $feature_flag_request_id: 'request-id',
                        $override_feature_flags: { overridden: true },
                        '$feature/active': true,
                        '$feature/variant': 'control',
                    }),
                }),
            })
        )

        expect(posthog.calculateEventProperties('segment-event', {})).toEqual(
            expect.objectContaining({
                $active_feature_flags: ['active', 'variant'],
                $feature_flag_request_id: 'request-id',
                '$feature/active': true,
                '$feature/variant': 'control',
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
        const featureFlags = new SharedFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))

        const setup = featureFlags.setup(posthog._getBrowserClientAdapter())

        expect(setup).toBeUndefined()
        expect(featureFlags.getFlagVariants()).toEqual({ 'cached-flag': 'control' })
        featureFlags.dispose()
    })

    it('runs persistence continuations in the same tick for browser-v1', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const featureFlags = new SharedFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(posthog._getBrowserClientAdapter())
        const captureError = vi.spyOn(featureFlags['_logger'], 'error').mockImplementation(() => {})
        const callback = vi.fn()
        featureFlags.addFeatureFlagsHandler(callback)
        vi.spyOn(console, 'log').mockImplementation(() => {})

        featureFlags.receivedFeatureFlags({ featureFlags: { 'test-flag': true } })
        expect(callback).toHaveBeenCalledTimes(1)

        callback.mockClear()
        featureFlags.overrideFeatureFlags({ flags: { 'test-flag': false }, suppressWarning: true })
        expect(callback).toHaveBeenCalledTimes(1)
        expect(featureFlags.getFeatureFlag('test-flag', { send_event: false })).toBe(false)

        const capture = vi.spyOn(posthog, 'capture')
        featureFlags.getFeatureFlag('test-flag')
        expect(capture).toHaveBeenCalledWith('$feature_flag_called', expect.any(Object))

        const reload = vi.spyOn(featureFlags, 'reloadFeatureFlags')
        featureFlags.setPersonPropertiesForFlags({ plan: 'pro' })
        featureFlags.setGroupPropertiesForFlags({ company: { plan: 'pro' } })
        expect(reload).toHaveBeenCalledTimes(2)

        capture.mockClear()
        featureFlags.updateEarlyAccessFeatureEnrollment('test-flag', true)
        expect(capture).toHaveBeenCalledWith('$feature_enrollment_update', expect.any(Object))
        expect(captureError).not.toHaveBeenCalled()
        featureFlags.dispose()
    })
})
