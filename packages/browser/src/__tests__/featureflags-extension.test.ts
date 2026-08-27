import type { ApiResponse } from '@posthog/browser-common'
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
import { PostHogPersistence } from '../posthog-persistence'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'

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
        const addWindowListener = jest.spyOn(window, 'addEventListener')
        const removeWindowListener = jest.spyOn(window, 'removeEventListener')
        const addDocumentListener = jest.spyOn(document, 'addEventListener')
        const removeDocumentListener = jest.spyOn(document, 'removeEventListener')
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))

        expect(addWindowListener).not.toHaveBeenCalled()
        expect(addDocumentListener).not.toHaveBeenCalled()
        featureFlags.setup(posthog._getBrowserClientAdapter())
        expect(addWindowListener).toHaveBeenCalledWith('online', expect.any(Function), {
            capture: false,
            passive: true,
        })
        expect(addDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function), {
            capture: false,
            passive: true,
        })

        featureFlags.dispose()
        featureFlags.dispose()
        expect(removeWindowListener).toHaveBeenCalledTimes(1)
        expect(removeWindowListener).toHaveBeenCalledWith('online', expect.any(Function))
        expect(removeDocumentListener).toHaveBeenCalledTimes(1)
        expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
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
        const callback = jest.fn()
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
        const capture = jest.spyOn(posthog, 'capture').mockImplementation()
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

        const setupFeatureFlagsWithInternalInterval = async (
            refreshIntervalMs?: number
        ): Promise<PostHogFeatureFlags> => {
            const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
            const config = new MutableFeatureFlagsConfigSource(defaultConfig()).get()
            featureFlags = new PostHogFeatureFlags({
                get: () => ({ ...config, refreshIntervalMs }),
            })
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

        it('does not start when the internal refresh interval is undefined', async () => {
            const featureFlags = await setupFeatureFlagsWithInternalInterval()
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            jest.advanceTimersByTime(defaultRefreshIntervalMs)
            document.dispatchEvent(new Event('visibilitychange'))

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('starts only after remote requests are enabled', async () => {
            const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
            const config = defaultConfig()
            config.remote_config_refresh_interval_ms = refreshIntervalMs
            featureFlags = new PostHogFeatureFlags(posthog)
            featureFlags.updateConfig(config, true)
            const addDocumentListener = jest.spyOn(document, 'addEventListener')

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

        it.each([0, -1])('does not start when the public refresh interval is %s', async (interval) => {
            const featureFlags = await setupFeatureFlags(interval)
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            jest.advanceTimersByTime(defaultRefreshIntervalMs)
            document.dispatchEvent(new Event('visibilitychange'))

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('uses the existing five-minute default when the public option is undefined', async () => {
            const featureFlags = await setupFeatureFlags()
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            jest.advanceTimersByTime(defaultRefreshIntervalMs - 1)
            expect(reloadFeatureFlags).not.toHaveBeenCalled()
            jest.advanceTimersByTime(1)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })

        it('applies an interval configured from the loaded callback', async () => {
            const posthog = await createPosthogInstance(undefined, {
                advanced_disable_feature_flags: true,
                loaded: (instance) => instance.set_config({ remote_config_refresh_interval_ms: refreshIntervalMs }),
            })
            featureFlags = posthog.featureFlags
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            jest.advanceTimersByTime(refreshIntervalMs)

            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
            await posthog.shutdown()
        })

        it('enables, restarts, or stops automatic refresh when public config changes', async () => {
            const posthog = await createPosthogInstance(undefined, {
                advanced_disable_feature_flags: true,
                remote_config_refresh_interval_ms: 0,
            })
            featureFlags = posthog.featureFlags
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            jest.advanceTimersByTime(defaultRefreshIntervalMs)
            expect(reloadFeatureFlags).not.toHaveBeenCalled()

            posthog.set_config({ remote_config_refresh_interval_ms: refreshIntervalMs })
            jest.advanceTimersByTime(refreshIntervalMs / 2)
            posthog.set_config({ remote_config_refresh_interval_ms: refreshIntervalMs * 2 })

            jest.advanceTimersByTime(refreshIntervalMs * 2 - 1)
            expect(reloadFeatureFlags).not.toHaveBeenCalled()
            jest.advanceTimersByTime(1)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)

            posthog.set_config({ remote_config_refresh_interval_ms: 0 })
            jest.advanceTimersByTime(refreshIntervalMs * 2)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
            await posthog.shutdown()
        })

        it('uses the latest interval when asynchronous setup completes', async () => {
            const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
            const client = posthog._getBrowserClientAdapter()
            let resolveInitialization: (() => void) | undefined
            jest.spyOn(client.kv, 'initialize').mockReturnValue(
                new Promise<void>((resolve) => {
                    resolveInitialization = resolve
                })
            )
            featureFlags = new PostHogFeatureFlags(posthog)
            const setup = featureFlags.setup(client)
            const config = defaultConfig()
            config.remote_config_refresh_interval_ms = refreshIntervalMs
            featureFlags.updateConfig(config, false)
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            resolveInitialization?.()
            await setup
            jest.advanceTimersByTime(refreshIntervalMs)

            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })

        it('reloads flags on the configured interval while visible', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            jest.advanceTimersByTime(refreshIntervalMs - 1)
            expect(reloadFeatureFlags).not.toHaveBeenCalled()

            jest.advanceTimersByTime(1)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })

        it('reloads due flags when a hidden page becomes visible', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            setVisibilityState('hidden')
            jest.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).not.toHaveBeenCalled()

            setVisibilityState('visible')
            document.dispatchEvent(new Event('visibilitychange'))
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })

        it('starts a full interval after a visibility refresh', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            setVisibilityState('hidden')
            jest.advanceTimersByTime(refreshIntervalMs + refreshIntervalMs / 2)
            setVisibilityState('visible')
            document.dispatchEvent(new Event('visibilitychange'))
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)

            jest.advanceTimersByTime(refreshIntervalMs - 1)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
            jest.advanceTimersByTime(1)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(2)
        })

        it('does not reload flags when the page becomes visible before the interval elapses', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            setVisibilityState('hidden')
            jest.advanceTimersByTime(refreshIntervalMs - 1)
            setVisibilityState('visible')
            document.dispatchEvent(new Event('visibilitychange'))

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('keeps automatic refresh active after flag state resets', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            featureFlags.reset()
            jest.advanceTimersByTime(refreshIntervalMs)

            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })

        it('stops automatic refresh on dispose', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            featureFlags.dispose()
            jest.advanceTimersByTime(refreshIntervalMs)
            document.dispatchEvent(new Event('visibilitychange'))

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('stops automatic refresh through the legacy destroy method', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            featureFlags.destroy()
            const config = defaultConfig()
            config.remote_config_refresh_interval_ms = refreshIntervalMs
            featureFlags.updateConfig(config, false)
            jest.advanceTimersByTime(refreshIntervalMs)
            document.dispatchEvent(new Event('visibilitychange'))

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('does not start automatic refresh when destroyed during asynchronous setup', async () => {
            const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
            const client = posthog._getBrowserClientAdapter()
            let resolveInitialization: (() => void) | undefined
            jest.spyOn(client.kv, 'initialize').mockReturnValue(
                new Promise<void>((resolve) => {
                    resolveInitialization = resolve
                })
            )
            featureFlags = new PostHogFeatureFlags(posthog)
            const config = defaultConfig()
            config.remote_config_refresh_interval_ms = refreshIntervalMs
            featureFlags.updateConfig(config, false)
            const setup = featureFlags.setup(client)
            const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

            featureFlags.destroy()
            resolveInitialization?.()
            await setup
            jest.advanceTimersByTime(refreshIntervalMs)

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('does not start without a document', async () => {
            const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
            const config = new MutableFeatureFlagsConfigSource(defaultConfig()).get()
            const setRefreshInterval = jest.spyOn(globalThis, 'setInterval')
            const addDocumentListener = jest.spyOn(document, 'addEventListener')
            setRefreshInterval.mockClear()
            addDocumentListener.mockClear()
            jest.doMock('@posthog/browser-common/utils/globals', () => ({
                ...jest.requireActual('@posthog/browser-common/utils/globals'),
                document: undefined,
            }))

            try {
                jest.isolateModules(() => {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { PostHogFeatureFlags: NoDocumentFeatureFlags } = require('../posthog-featureflags')
                    const noDocumentFeatureFlags = new NoDocumentFeatureFlags({
                        get: () => ({ ...config, refreshIntervalMs }),
                    })

                    noDocumentFeatureFlags.setup(posthog._getBrowserClientAdapter())

                    expect(noDocumentFeatureFlags['_refreshInterval']).toBeUndefined()
                    noDocumentFeatureFlags.dispose()
                })
            } finally {
                jest.dontMock('@posthog/browser-common/utils/globals')
            }

            expect(setRefreshInterval).not.toHaveBeenCalled()
            expect(addDocumentListener).not.toHaveBeenCalledWith(
                'visibilitychange',
                expect.any(Function),
                expect.anything()
            )
            await posthog.shutdown()
        })

        it('starts without a document event API', async () => {
            const addEventListener = document.addEventListener
            Object.defineProperty(document, 'addEventListener', { value: undefined, configurable: true })

            try {
                const featureFlags = await setupFeatureFlags(refreshIntervalMs)
                const reloadFeatureFlags = jest.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation()

                jest.advanceTimersByTime(refreshIntervalMs)

                expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
            } finally {
                Object.defineProperty(document, 'addEventListener', { value: addEventListener, configurable: true })
            }
        })
    })

    it('preserves the legacy initialize and destroy methods', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const removeListener = jest.spyOn(window, 'removeEventListener')
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(posthog._getBrowserClientAdapter())

        expect(() => featureFlags.initialize()).not.toThrow()
        expect(() => featureFlags.destroy()).not.toThrow()
        expect(removeListener).toHaveBeenCalledWith('online', expect.any(Function))

        featureFlags.dispose()
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

    it('continues reloading when a reloading handler throws', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        const sendRequest = jest.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json: {} })
        jest.spyOn(client.logger, 'createLogger').mockReturnValue(client.logger)
        const error = jest.spyOn(client.logger, 'error').mockImplementation()
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(client)
        const handlerError = new Error('handler failed')
        const laterHandler = jest.fn()
        featureFlags.onReloading(() => {
            throw handlerError
        })
        featureFlags.onReloading(laterHandler)

        expect(() => featureFlags.reloadFeatureFlags()).not.toThrow()
        expect(laterHandler).toHaveBeenCalledTimes(1)
        expect(error).toHaveBeenCalledWith('Error while running feature flags reloading callback', handlerError)

        jest.advanceTimersByTime(5)
        expect(sendRequest).toHaveBeenCalledTimes(1)
        featureFlags.dispose()
    })

    it('propagates set_config updates to the enrolled feature flags extension', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const sendRequest = jest
            .spyOn(posthog._getBrowserClientAdapter(), 'sendRequest')
            .mockResolvedValue({ statusCode: 200, json: {} })

        posthog.set_config({
            advanced_disable_feature_flags: false,
            evaluation_contexts: ['updated-context'],
        })
        posthog.reloadFeatureFlags()
        await jest.advanceTimersByTimeAsync(5)

        expect(sendRequest).toHaveBeenCalledWith(
            '/flags/?v=2',
            expect.objectContaining({
                body: expect.objectContaining({ evaluation_contexts: ['updated-context'] }),
            })
        )
    })

    it('logs feature flag request failures through the scoped logger', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        const clientError = jest.spyOn(client.logger, 'error').mockImplementation()
        const scopedLogger = client.logger.createLogger('[FeatureFlags]')
        const scopedError = jest.spyOn(scopedLogger, 'error').mockImplementation()
        jest.spyOn(client.logger, 'createLogger').mockReturnValue(scopedLogger)
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(client)
        const requestError = new Error('request failed')
        jest.spyOn(client, 'sendRequest').mockRejectedValue(requestError)

        featureFlags._callFlagsEndpoint()
        await Promise.resolve()
        await Promise.resolve()

        expect(scopedError).toHaveBeenCalledWith('Feature flag request failed', requestError)
        expect(clientError).not.toHaveBeenCalled()
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

    it('snapshots feature flag persistence after loading a v2 response', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(posthog._getBrowserClientAdapter())

        featureFlags.receivedFeatureFlags({
            flags: {
                'boolean-flag': {
                    key: 'boolean-flag',
                    enabled: true,
                    variant: undefined,
                    reason: { code: 'condition_match', condition_index: 0, description: 'matched boolean condition' },
                    metadata: {
                        id: 1,
                        version: 2,
                        description: 'Boolean flag',
                        payload: undefined,
                        has_experiment: false,
                    },
                },
                'variant-flag': {
                    key: 'variant-flag',
                    enabled: true,
                    variant: 'control',
                    reason: { code: 'condition_match', condition_index: 1, description: 'matched variant condition' },
                    metadata: {
                        id: 2,
                        version: 3,
                        description: 'Variant flag',
                        payload: '{"layout":"compact"}',
                        has_experiment: true,
                    },
                },
                'disabled-flag': {
                    key: 'disabled-flag',
                    enabled: false,
                    variant: undefined,
                    reason: { code: 'no_condition_match', condition_index: undefined, description: 'no match' },
                    metadata: {
                        id: 3,
                        version: 4,
                        description: 'Disabled flag',
                        payload: undefined,
                    },
                },
            },
            requestId: 'flags-request-id',
            evaluatedAt: 1700000000000,
            minimalFlagCalledEvents: true,
        })

        expect({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: posthog.persistence?.get_property(PERSISTENCE_ACTIVE_FEATURE_FLAGS),
            [ENABLED_FEATURE_FLAGS]: posthog.persistence?.get_property(ENABLED_FEATURE_FLAGS),
            [PERSISTENCE_FEATURE_FLAG_DETAILS]: posthog.persistence?.get_property(PERSISTENCE_FEATURE_FLAG_DETAILS),
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: posthog.persistence?.get_property(PERSISTENCE_FEATURE_FLAG_PAYLOADS),
            [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: posthog.persistence?.get_property(
                PERSISTENCE_FEATURE_FLAG_REQUEST_ID
            ),
            [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: posthog.persistence?.get_property(
                PERSISTENCE_FEATURE_FLAG_EVALUATED_AT
            ),
            [PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS]: posthog.persistence?.get_property(
                PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS
            ),
        }).toMatchSnapshot()
        featureFlags.dispose()
    })

    it.each([
        ['fresh', () => Date.now() - 30 * 60 * 1000, true],
        ['expired', () => Date.now() - 2 * 60 * 60 * 1000, false],
        ['non-numeric', () => '2025-01-01T00:00:00Z', false],
    ])('uses %s persisted cache state for dynamic event properties', async (_, evaluatedAt, includesFlag) => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        posthog.persistence?.register({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['cached-flag'],
            [ENABLED_FEATURE_FLAGS]: { 'cached-flag': 'control' },
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { 'cached-flag': { source: 'cache' } },
            [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: 'cached-request-id',
            [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: evaluatedAt(),
        })
        const registerProperties = jest.spyOn(posthog, '_registerExtensionEventProperties')
        const config = defaultConfig()
        config.advanced_disable_feature_flags = true
        config.feature_flag_cache_ttl_ms = 60 * 60 * 1000
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(config))
        featureFlags.setup(posthog._getBrowserClientAdapter())

        const properties = registerProperties.mock.calls[0][0]()
        expect(properties).toMatchObject({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['cached-flag'],
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { 'cached-flag': { source: 'cache' } },
            [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: 'cached-request-id',
        })
        if (includesFlag) {
            expect(properties).toHaveProperty('$feature/cached-flag', 'control')
        } else {
            expect(properties).not.toHaveProperty('$feature/cached-flag')
        }
        featureFlags.dispose()
    })

    it('enriches ordinary capture and direct calculation without enriching snapshots', async () => {
        const posthog = await createPosthogInstance(undefined, {
            advanced_disable_feature_flags: true,
            request_batching: true,
            before_send: (event) => event,
        })
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        await featureFlags.setup(posthog._getBrowserClientAdapter())
        posthog.persistence?.register({
            $feature_flag_request_id: 'request-id',
            $override_feature_flags: { overridden: true },
        })
        featureFlags.updateFlags(
            { active: true, variant: 'control' },
            { active: { configured: true }, variant: 'payload' }
        )

        const enqueue = jest.spyOn(posthog._requestQueue!, 'enqueue')
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

        expect(featureFlags._callFlagsEndpoint()).toBeUndefined()

        expect(sendRequest).toHaveBeenCalledWith(
            '/flags/?v=2&only_evaluate_survey_feature_flags=true',
            expect.objectContaining({
                target: 'flags',
                method: 'POST',
                compression: 'best-available',
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

    it('coalesces reloads behind an in-flight request after a quota-limited response', async () => {
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
        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(5)

        expect(sendRequest).toHaveBeenCalledTimes(1)

        resolveRequests[0]({ statusCode: 200, json: { quotaLimited: ['feature_flags'] } })
        await Promise.resolve()

        expect(sendRequest).toHaveBeenCalledTimes(2)
        expect(sendRequest.mock.calls[1][1]?.body).toMatchObject({
            distinct_id: 'identified-id',
            $anon_distinct_id: 'anonymous-id',
        })

        resolveRequests[1]({ statusCode: 200, json: { featureFlags: { current: true } } })
        await firstRequest
        expect(featureFlags.getFlagVariants()).toEqual({ current: true })
        featureFlags.dispose()
    })

    it('keeps an in-flight request single-flight through reset without applying its response', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        let distinctId = 'identified-id'
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
        const callback = jest.fn()
        featureFlags.addFeatureFlagsHandler(callback)

        const firstRequest = featureFlags._callFlagsEndpoint()
        distinctId = 'reset-id'
        featureFlags.reset()
        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(5)

        expect(sendRequest).toHaveBeenCalledTimes(1)

        resolveRequests[0]({ statusCode: 200, json: { featureFlags: { stale: true } } })
        await Promise.resolve()

        expect(callback).not.toHaveBeenCalled()
        expect(featureFlags.getFlagVariants()).toEqual({})
        expect(sendRequest).toHaveBeenCalledTimes(2)
        expect(sendRequest.mock.calls[1][1]?.body).toMatchObject({ distinct_id: 'reset-id' })

        resolveRequests[1]({ statusCode: 200, json: { featureFlags: { current: true } } })
        await firstRequest
        expect(callback).toHaveBeenCalledTimes(1)
        expect(featureFlags.getFlagVariants()).toEqual({ current: true })
        featureFlags.dispose()
    })

    it('drops queued work and status tracking from the generation before reset', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        let resolveRequest: ((response: ApiResponse) => void) | undefined
        const sendRequest = jest.spyOn(client, 'sendRequest').mockImplementation(
            () =>
                new Promise<ApiResponse>((resolve) => {
                    resolveRequest = resolve
                })
        )
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(client)
        const callback = jest.fn()
        featureFlags.addFeatureFlagsHandler(callback)

        featureFlags._callFlagsEndpoint()
        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(5)
        featureFlags.reset()
        resolveRequest?.({ statusCode: 0 })
        await Promise.resolve()

        expect(sendRequest).toHaveBeenCalledTimes(1)
        expect(callback).not.toHaveBeenCalled()
        expect(featureFlags['_consecutiveStatusZeroFailures']).toBe(0)
        featureFlags.dispose()
    })

    it('ignores an in-flight response and queued reload after disposal', async () => {
        const posthog = await createPosthogInstance(undefined, { advanced_disable_feature_flags: true })
        const client = posthog._getBrowserClientAdapter()
        let resolveRequest: ((response: ApiResponse) => void) | undefined
        const sendRequest = jest.spyOn(client, 'sendRequest').mockImplementation(
            () =>
                new Promise<ApiResponse>((resolve) => {
                    resolveRequest = resolve
                })
        )
        const featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(defaultConfig()))
        featureFlags.setup(client)
        const callback = jest.fn()
        featureFlags.addFeatureFlagsHandler(callback)

        featureFlags._callFlagsEndpoint()
        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(5)
        featureFlags.dispose()
        resolveRequest?.({
            statusCode: 0,
            json: { flags: { stale: { key: 'stale', enabled: true } } },
        })
        await Promise.resolve()
        await Promise.resolve()

        expect(sendRequest).toHaveBeenCalledTimes(1)
        expect(callback).not.toHaveBeenCalled()
        expect(featureFlags.getFeatureFlag('stale', { send_event: false })).toBeUndefined()
        expect(featureFlags['_consecutiveStatusZeroFailures']).toBe(0)
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
