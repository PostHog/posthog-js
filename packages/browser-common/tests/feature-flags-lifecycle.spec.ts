// @vitest-environment jsdom
/* oxlint-disable compat/compat */
import { isUndefined } from '@posthog/core'
import type { ApiResponse } from '../src/client'
import { PostHogFeatureFlags, PostHogFeatureFlags as SharedFeatureFlags, FeatureFlagError } from '../src/feature-flags'
import {
    ENABLED_FEATURE_FLAGS,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_ERRORS,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
    PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS,
    STORED_PERSON_PROPERTIES_KEY,
} from '../src/constants'
import { createConfig, createFlagsClient } from './helpers/feature-flags'

describe('PostHogFeatureFlags extension lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('has a side-effect-free constructor and disposes setup listeners idempotently', async () => {
        const client = createFlagsClient()
        const addWindowListener = vi.spyOn(window, 'addEventListener')
        const removeWindowListener = vi.spyOn(window, 'removeEventListener')
        const addDocumentListener = vi.spyOn(document, 'addEventListener')
        const removeDocumentListener = vi.spyOn(document, 'removeEventListener')
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig({ refreshIntervalMs: 60_000 }) })

        expect(addWindowListener).not.toHaveBeenCalled()
        expect(addDocumentListener).not.toHaveBeenCalled()
        featureFlags.setup(client)
        expect(addWindowListener).toHaveBeenCalledWith('online', expect.any(Function), {
            capture: false,
            passive: true,
        })
        expect(addDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function), {
            capture: false,
            passive: true,
        })
        expect(addDocumentListener).toHaveBeenCalledWith('click', expect.any(Function), {
            capture: true,
            passive: true,
        })

        featureFlags.dispose()
        featureFlags.dispose()
        expect(removeWindowListener).toHaveBeenCalledTimes(1)
        expect(removeWindowListener).toHaveBeenCalledWith('online', expect.any(Function))
        expect(removeDocumentListener).toHaveBeenCalledTimes(6)
        expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
        expect(removeDocumentListener).toHaveBeenCalledWith('click', expect.any(Function), { capture: true })
    })
    describe('automatic refresh', () => {
        const refreshIntervalMs = 60_000
        const defaultRefreshIntervalMs = 5 * 60_000
        const maxIdleRefreshIntervalMs = 60 * 60_000
        let featureFlags: PostHogFeatureFlags | undefined
        let sharedFeatureFlags: SharedFeatureFlags | undefined

        const setVisibilityState = (state: DocumentVisibilityState): void => {
            Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
        }

        const setupFeatureFlags = async (interval?: number): Promise<PostHogFeatureFlags> => {
            featureFlags = new PostHogFeatureFlags({
                get: () =>
                    createConfig({
                        refreshIntervalMs: interval ?? defaultRefreshIntervalMs,
                        idleRefreshBackoff: isUndefined(interval),
                    }),
            })
            await featureFlags.setup(createFlagsClient())
            return featureFlags
        }

        const setupFeatureFlagsWithInternalInterval = async (
            refreshIntervalMs?: number
        ): Promise<SharedFeatureFlags> => {
            const client = createFlagsClient()
            const config = createConfig()
            sharedFeatureFlags = new SharedFeatureFlags({
                get: () => ({ ...config, refreshIntervalMs }),
            })
            await sharedFeatureFlags.setup(client)
            return sharedFeatureFlags
        }

        beforeEach(() => {
            setVisibilityState('visible')
        })

        afterEach(() => {
            featureFlags?.dispose()
            featureFlags = undefined
            sharedFeatureFlags?.dispose()
            sharedFeatureFlags = undefined
            setVisibilityState('visible')
        })

        it('does not start when the internal refresh interval is undefined', async () => {
            const featureFlags = await setupFeatureFlagsWithInternalInterval()
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(defaultRefreshIntervalMs)
            document.dispatchEvent(new Event('visibilitychange'))

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it.each([0, -1])('does not start when the public refresh interval is %s', async (interval) => {
            const featureFlags = await setupFeatureFlags(interval)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(defaultRefreshIntervalMs)
            document.dispatchEvent(new Event('visibilitychange'))

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it.each([refreshIntervalMs, defaultRefreshIntervalMs, maxIdleRefreshIntervalMs * 2])(
            'keeps the explicit %s ms interval fixed on an idle page',
            async (interval) => {
                const featureFlags = await setupFeatureFlags(interval)
                const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

                for (let i = 1; i <= 5; i++) {
                    vi.advanceTimersByTime(interval)
                    expect(reloadFeatureFlags).toHaveBeenCalledTimes(i)
                }
            }
        )

        it('reloads flags on the configured interval while visible', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(refreshIntervalMs - 1)
            expect(reloadFeatureFlags).not.toHaveBeenCalled()

            vi.advanceTimersByTime(1)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })

        it('reloads due flags when a hidden page becomes visible', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            setVisibilityState('hidden')
            vi.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).not.toHaveBeenCalled()

            setVisibilityState('visible')
            document.dispatchEvent(new Event('visibilitychange'))
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })

        it('starts a full interval after a visibility refresh', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            setVisibilityState('hidden')
            vi.advanceTimersByTime(refreshIntervalMs + refreshIntervalMs / 2)
            setVisibilityState('visible')
            document.dispatchEvent(new Event('visibilitychange'))
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)

            vi.advanceTimersByTime(refreshIntervalMs - 1)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
            vi.advanceTimersByTime(1)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(2)
        })

        it('reloads due flags on return to visibility after an earlier interaction', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(refreshIntervalMs / 2)
            document.dispatchEvent(new Event('click'))
            expect(reloadFeatureFlags).not.toHaveBeenCalled()

            setVisibilityState('hidden')
            vi.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).not.toHaveBeenCalled()

            setVisibilityState('visible')
            document.dispatchEvent(new Event('visibilitychange'))
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })

        it('does not reload flags when the page becomes visible before the interval elapses', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            setVisibilityState('hidden')
            vi.advanceTimersByTime(refreshIntervalMs - 1)
            setVisibilityState('visible')
            document.dispatchEvent(new Event('visibilitychange'))

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('backs off the implicit default while the visible page has no user interaction', async () => {
            const refreshIntervalMs = defaultRefreshIntervalMs
            const featureFlags = await setupFeatureFlags()
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)

            // The second refresh now needs two intervals, the third one four.
            vi.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
            vi.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(2)

            vi.advanceTimersByTime(refreshIntervalMs * 3)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(2)
            vi.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(3)
        })

        it('continues refreshing at the maximum idle interval', async () => {
            const featureFlags = await setupFeatureFlags()
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            for (let i = 0; i < 20; i++) {
                vi.advanceTimersByTime(maxIdleRefreshIntervalMs)
            }
            expect(featureFlags['_dueRefreshIntervalMs']).toBe(maxIdleRefreshIntervalMs)

            const refreshCount = reloadFeatureFlags.mock.calls.length
            vi.advanceTimersByTime(maxIdleRefreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(refreshCount + 1)
        })

        it('returns to the default interval after a user interaction', async () => {
            const refreshIntervalMs = defaultRefreshIntervalMs
            const featureFlags = await setupFeatureFlags()
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(refreshIntervalMs * 3)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(2)

            document.dispatchEvent(new Event('click'))
            vi.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(3)

            document.dispatchEvent(new Event('keydown'))
            vi.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(4)
        })

        it('reloads due flags on a user interaction after a long idle period', async () => {
            const refreshIntervalMs = defaultRefreshIntervalMs
            const featureFlags = await setupFeatureFlags()
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(refreshIntervalMs * 3)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(2)

            // The next scheduled refresh is four intervals away, the interaction brings it forward.
            vi.advanceTimersByTime(refreshIntervalMs)
            document.dispatchEvent(new Event('wheel'))
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(3)
        })

        it('keeps backing off when only a scroll event fires', async () => {
            const refreshIntervalMs = defaultRefreshIntervalMs
            const featureFlags = await setupFeatureFlags()
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)

            // A carousel scrolling itself is not a user interaction, so the next refresh still
            // needs two intervals.
            document.dispatchEvent(new Event('scroll'))
            vi.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
            vi.advanceTimersByTime(refreshIntervalMs)
            expect(reloadFeatureFlags).toHaveBeenCalledTimes(2)
        })

        it('does not reload flags on a user interaction before the interval elapses', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            vi.advanceTimersByTime(refreshIntervalMs - 1)
            document.dispatchEvent(new Event('click'))

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('keeps automatic refresh active after flag state resets', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            featureFlags.reset()
            vi.advanceTimersByTime(refreshIntervalMs)

            expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
        })

        it('stops automatic refresh on dispose', async () => {
            const featureFlags = await setupFeatureFlags(refreshIntervalMs)
            const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

            featureFlags.dispose()
            vi.advanceTimersByTime(refreshIntervalMs)
            document.dispatchEvent(new Event('visibilitychange'))

            expect(reloadFeatureFlags).not.toHaveBeenCalled()
        })

        it('does not start without a document', async () => {
            const client = createFlagsClient()
            const config = createConfig()
            const setRefreshInterval = vi.spyOn(globalThis, 'setInterval')
            const addDocumentListener = vi.spyOn(document, 'addEventListener')
            setRefreshInterval.mockClear()
            addDocumentListener.mockClear()
            vi.doMock('../src/utils/globals', async (importOriginal) => ({
                ...(await importOriginal<typeof import('../src/utils/globals')>()),
                document: undefined,
            }))

            try {
                vi.resetModules()
                const { PostHogFeatureFlags: NoDocumentFeatureFlags } = await import('../src/feature-flags')
                const noDocumentFeatureFlags = new NoDocumentFeatureFlags({
                    get: () => ({ ...config, refreshIntervalMs }),
                })

                await noDocumentFeatureFlags.setup(client)

                expect(noDocumentFeatureFlags['_refreshInterval']).toBeUndefined()
                noDocumentFeatureFlags.dispose()
            } finally {
                vi.doUnmock('../src/utils/globals')
                vi.resetModules()
            }

            expect(setRefreshInterval).not.toHaveBeenCalled()
            expect(addDocumentListener).not.toHaveBeenCalledWith(
                'visibilitychange',
                expect.any(Function),
                expect.anything()
            )
            client.dispose()
        })

        it('starts without a document event API', async () => {
            const addEventListener = document.addEventListener
            Object.defineProperty(document, 'addEventListener', { value: undefined, configurable: true })

            try {
                const featureFlags = await setupFeatureFlags(refreshIntervalMs)
                const reloadFeatureFlags = vi.spyOn(featureFlags, 'reloadFeatureFlags').mockImplementation(() => {})

                vi.advanceTimersByTime(refreshIntervalMs)

                expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
            } finally {
                Object.defineProperty(document, 'addEventListener', { value: addEventListener, configurable: true })
            }
        })
    })

    it('preserves the legacy initialize and destroy methods', async () => {
        const client = createFlagsClient()
        const removeListener = vi.spyOn(window, 'removeEventListener')
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)

        expect(() => featureFlags.initialize()).not.toThrow()
        expect(() => featureFlags.destroy()).not.toThrow()
        expect(removeListener).toHaveBeenCalledWith('online', expect.any(Function))

        featureFlags.dispose()
    })

    it('does not send a debounced request after reset', async () => {
        const client = createFlagsClient()
        const sendRequest = vi.spyOn(client, 'sendRequest')
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)

        featureFlags.reloadFeatureFlags()
        featureFlags.reset()
        vi.advanceTimersByTime(10)

        expect(sendRequest).not.toHaveBeenCalled()
        featureFlags.dispose()
    })

    it('continues reloading when a reloading handler throws', async () => {
        const client = createFlagsClient()
        const sendRequest = vi.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json: {} })
        vi.spyOn(client.logger, 'createLogger').mockReturnValue(client.logger)
        const error = vi.spyOn(client.logger, 'error').mockImplementation(() => {})
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)
        const handlerError = new Error('handler failed')
        const laterHandler = vi.fn()
        featureFlags.onReloading(() => {
            throw handlerError
        })
        featureFlags.onReloading(laterHandler)

        expect(() => featureFlags.reloadFeatureFlags()).not.toThrow()
        expect(laterHandler).toHaveBeenCalledTimes(1)
        expect(error).toHaveBeenCalledWith('Error while running feature flags reloading callback', handlerError)

        vi.advanceTimersByTime(5)
        expect(sendRequest).toHaveBeenCalledTimes(1)
        featureFlags.dispose()
    })

    it('logs feature flag request failures through the scoped logger', async () => {
        const client = createFlagsClient()
        const clientError = vi.spyOn(client.logger, 'error').mockImplementation(() => {})
        const scopedLogger = client.logger.createLogger('[FeatureFlags]')
        const scopedError = vi.spyOn(scopedLogger, 'error').mockImplementation(() => {})
        vi.spyOn(client.logger, 'createLogger').mockReturnValue(scopedLogger)
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)
        const requestError = new Error('request failed')
        vi.spyOn(client, 'sendRequest').mockRejectedValue(requestError)

        featureFlags._callFlagsEndpoint()

        await vi.waitFor(() => {
            expect(scopedError).toHaveBeenCalledWith('Feature flag request failed', requestError)
        })
        expect(clientError).not.toHaveBeenCalled()
        featureFlags.dispose()
    })

    it('keeps persisted flags as an offline fallback when bootstrap flags are provided', async () => {
        const client = createFlagsClient()
        client.kv.set({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['persisted-flag'],
            [ENABLED_FEATURE_FLAGS]: { 'persisted-flag': true },
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { 'persisted-flag': { source: 'persistence' } },
        })
        const config = createConfig()
        config.bootstrap = {
            featureFlags: { 'bootstrap-flag': true },
            featureFlagPayloads: { 'bootstrap-flag': { source: 'bootstrap' } },
        }
        const sendRequest = vi.spyOn(client, 'sendRequest').mockResolvedValueOnce({ statusCode: 0 })
        const featureFlags = new SharedFeatureFlags({ get: () => config })
        featureFlags.setup(client)

        expect(featureFlags.getFeatureFlag('bootstrap-flag', { send_event: false })).toBe(true)
        expect(featureFlags.getFeatureFlag('persisted-flag', { send_event: false })).toBeUndefined()
        expect(client.kv.get(ENABLED_FEATURE_FLAGS)).toEqual({ 'persisted-flag': true })

        featureFlags._callFlagsEndpoint()
        await vi.waitFor(() => {
            expect(featureFlags.getFeatureFlag('bootstrap-flag', { send_event: false })).toBeUndefined()
        })
        expect(featureFlags.getFeatureFlagResult('persisted-flag', { send_event: false })).toEqual({
            key: 'persisted-flag',
            enabled: true,
            variant: undefined,
            payload: { source: 'persistence' },
        })
        expect(client.kv.get(ENABLED_FEATURE_FLAGS)).toEqual({ 'persisted-flag': true })

        sendRequest.mockResolvedValueOnce({
            statusCode: 200,
            json: { featureFlags: { 'remote-flag': true } },
        })
        featureFlags._callFlagsEndpoint()
        await vi.waitFor(() => {
            expect(featureFlags.getFeatureFlag('remote-flag', { send_event: false })).toBe(true)
        })

        expect(featureFlags.getFeatureFlag('persisted-flag', { send_event: false })).toBeUndefined()
        expect(client.kv.get(ENABLED_FEATURE_FLAGS)).toEqual({ 'remote-flag': true })
        featureFlags.dispose()
    })

    it('keeps bootstrap flags after a request failure when there is no older persisted fallback', async () => {
        const client = createFlagsClient()
        const config = createConfig()
        config.bootstrap = { featureFlags: { 'bootstrap-flag': true } }
        vi.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 0 })
        const featureFlags = new SharedFeatureFlags({ get: () => config })
        featureFlags.setup(client)

        expect(client.kv.get(ENABLED_FEATURE_FLAGS)).toEqual({ 'bootstrap-flag': true })
        featureFlags._callFlagsEndpoint()
        await vi.waitFor(() => {
            expect(client.kv.get(PERSISTENCE_FEATURE_FLAG_ERRORS)).toEqual([FeatureFlagError.apiError(0)])
        })

        expect(featureFlags.getFeatureFlag('bootstrap-flag', { send_event: false })).toBe(true)
        featureFlags.dispose()
    })

    it('reuses cached dynamic event property snapshots until flag state changes', async () => {
        const client = createFlagsClient()
        const registerProperties = vi.spyOn(client, 'registerDynamicEventProperties')
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)
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
        const client = createFlagsClient()
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)

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
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: client.kv.get(PERSISTENCE_ACTIVE_FEATURE_FLAGS),
            [ENABLED_FEATURE_FLAGS]: client.kv.get(ENABLED_FEATURE_FLAGS),
            [PERSISTENCE_FEATURE_FLAG_DETAILS]: client.kv.get(PERSISTENCE_FEATURE_FLAG_DETAILS),
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: client.kv.get(PERSISTENCE_FEATURE_FLAG_PAYLOADS),
            [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: client.kv.get(PERSISTENCE_FEATURE_FLAG_REQUEST_ID),
            [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: client.kv.get(PERSISTENCE_FEATURE_FLAG_EVALUATED_AT),
            [PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS]: client.kv.get(PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS),
        }).toMatchSnapshot()
        featureFlags.dispose()
    })

    it.each([
        ['fresh', () => Date.now() - 30 * 60 * 1000, true],
        ['expired', () => Date.now() - 2 * 60 * 60 * 1000, false],
        ['non-numeric', () => '2025-01-01T00:00:00Z', false],
    ])('uses %s persisted cache state for dynamic event properties', async (_, evaluatedAt, includesFlag) => {
        const client = createFlagsClient()
        client.kv.set({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['cached-flag'],
            [ENABLED_FEATURE_FLAGS]: { 'cached-flag': 'control' },
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { 'cached-flag': { source: 'cache' } },
            [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: 'cached-request-id',
            [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: evaluatedAt(),
        })
        const registerProperties = vi.spyOn(client, 'registerDynamicEventProperties')
        const config = createConfig()
        config.featureFlagsDisabled = true
        config.cacheTtlMs = 60 * 60 * 1000
        const featureFlags = new SharedFeatureFlags({ get: () => config })
        featureFlags.setup(client)

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

    it('uses flags transport semantics and semantic request configuration', async () => {
        const client = createFlagsClient()
        const sendRequest = vi.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json: {} })
        const config = createConfig()
        config.onlyEvaluateSurveyFeatureFlags = true
        config.evaluationContexts = ['production']
        config.flagKeys = ['survey-flag']
        config.requestTimeoutMs = 1234
        const featureFlags = new SharedFeatureFlags({ get: () => config })
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

    it('preserves the anonymous id when a reload is queued before an in-flight response completes', async () => {
        const client = createFlagsClient()
        client.distinctId = 'anonymous-id'
        const resolveRequests: Array<(response: ApiResponse) => void> = []
        const sendRequest = vi.spyOn(client, 'sendRequest').mockImplementation(
            () =>
                new Promise<ApiResponse>((resolve) => {
                    resolveRequests.push(resolve)
                })
        )
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)

        featureFlags._callFlagsEndpoint()
        client.distinctId = 'identified-id'
        featureFlags.setAnonymousDistinctId('anonymous-id')
        featureFlags.reloadFeatureFlags()

        resolveRequests[0]({ statusCode: 200, json: { featureFlags: { initial: true } } })

        await vi.waitFor(() => {
            expect(sendRequest).toHaveBeenCalledTimes(2)
        })
        expect(sendRequest.mock.calls[1][1]?.body).toMatchObject({
            distinct_id: 'identified-id',
            $anon_distinct_id: 'anonymous-id',
        })

        resolveRequests[1]({ statusCode: 200, json: { featureFlags: { current: true } } })
        await vi.waitFor(() => {
            expect(featureFlags.getFlagVariants()).toEqual({ current: true })
        })
        expect(sendRequest).toHaveBeenCalledTimes(2)
        featureFlags.dispose()
        client.dispose()
    })

    it('coalesces reloads behind an in-flight request after a quota-limited response', async () => {
        const client = createFlagsClient()
        client.distinctId = 'anonymous-id'
        const resolveRequests: Array<(response: ApiResponse) => void> = []
        const sendRequest = vi.spyOn(client, 'sendRequest').mockImplementation(
            () =>
                new Promise<ApiResponse>((resolve) => {
                    resolveRequests.push(resolve)
                })
        )
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)

        featureFlags._callFlagsEndpoint()
        client.distinctId = 'identified-id'
        featureFlags.setAnonymousDistinctId('anonymous-id')
        featureFlags.reloadFeatureFlags()
        vi.advanceTimersByTime(5)
        featureFlags.reloadFeatureFlags()
        vi.advanceTimersByTime(5)

        expect(sendRequest).toHaveBeenCalledTimes(1)

        resolveRequests[0]({ statusCode: 200, json: { quotaLimited: ['feature_flags'] } })

        await vi.waitFor(() => {
            expect(sendRequest).toHaveBeenCalledTimes(2)
        })
        expect(sendRequest.mock.calls[1][1]?.body).toMatchObject({
            distinct_id: 'identified-id',
            $anon_distinct_id: 'anonymous-id',
        })

        resolveRequests[1]({ statusCode: 200, json: { featureFlags: { current: true } } })
        await vi.waitFor(() => {
            expect(featureFlags.getFlagVariants()).toEqual({ current: true })
        })
        featureFlags.dispose()
    })

    it('keeps an in-flight request single-flight through reset without applying its response', async () => {
        const client = createFlagsClient()
        client.distinctId = 'identified-id'
        const resolveRequests: Array<(response: ApiResponse) => void> = []
        const sendRequest = vi.spyOn(client, 'sendRequest').mockImplementation(
            () =>
                new Promise<ApiResponse>((resolve) => {
                    resolveRequests.push(resolve)
                })
        )
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)
        const callback = vi.fn()
        featureFlags.addFeatureFlagsHandler(callback)

        featureFlags._callFlagsEndpoint()
        client.distinctId = 'reset-id'
        featureFlags.reset()
        featureFlags.reloadFeatureFlags()
        vi.advanceTimersByTime(5)

        expect(sendRequest).toHaveBeenCalledTimes(1)

        resolveRequests[0]({ statusCode: 200, json: { featureFlags: { stale: true } } })

        await vi.waitFor(() => {
            expect(sendRequest).toHaveBeenCalledTimes(2)
        })
        expect(callback).not.toHaveBeenCalled()
        expect(featureFlags.getFlagVariants()).toEqual({})
        expect(sendRequest.mock.calls[1][1]?.body).toMatchObject({ distinct_id: 'reset-id' })

        resolveRequests[1]({ statusCode: 200, json: { featureFlags: { current: true } } })
        await vi.waitFor(() => {
            expect(callback).toHaveBeenCalledTimes(1)
            expect(featureFlags.getFlagVariants()).toEqual({ current: true })
        })
        featureFlags.dispose()
    })

    it('drops queued work and status tracking from the generation before reset', async () => {
        const client = createFlagsClient()
        let resolveRequest: ((response: ApiResponse) => void) | undefined
        const sendRequest = vi.spyOn(client, 'sendRequest').mockImplementation(
            () =>
                new Promise<ApiResponse>((resolve) => {
                    resolveRequest = resolve
                })
        )
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)
        const callback = vi.fn()
        featureFlags.addFeatureFlagsHandler(callback)

        featureFlags._callFlagsEndpoint()
        featureFlags.reloadFeatureFlags()
        vi.advanceTimersByTime(5)
        featureFlags.reset()
        resolveRequest?.({ statusCode: 0 })
        await Promise.resolve()

        expect(sendRequest).toHaveBeenCalledTimes(1)
        expect(callback).not.toHaveBeenCalled()
        expect(featureFlags['_consecutiveStatusZeroFailures']).toBe(0)
        featureFlags.dispose()
    })

    it('ignores an in-flight response and queued reload after disposal', async () => {
        const client = createFlagsClient()
        let resolveRequest: ((response: ApiResponse) => void) | undefined
        const sendRequest = vi.spyOn(client, 'sendRequest').mockImplementation(
            () =>
                new Promise<ApiResponse>((resolve) => {
                    resolveRequest = resolve
                })
        )
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)
        const callback = vi.fn()
        featureFlags.addFeatureFlagsHandler(callback)

        featureFlags._callFlagsEndpoint()
        featureFlags.reloadFeatureFlags()
        vi.advanceTimersByTime(5)
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

    it('persists early access enrollment coherently before callbacks and capture', async () => {
        const client = createFlagsClient()
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })
        featureFlags.setup(client)
        const callback = vi.fn()
        featureFlags.addFeatureFlagsHandler(callback)
        const capture = vi.spyOn(client, 'capture').mockImplementation(() => {})
        const setPersistence = vi.spyOn(client.kv, 'set')

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
        const client = createFlagsClient()
        client.kv.set({ [ENABLED_FEATURE_FLAGS]: { initialized: true } })
        let resolveInitialization: (() => void) | undefined
        vi.spyOn(client.kv, 'initialize').mockReturnValue(
            new Promise<void>((resolve) => {
                resolveInitialization = resolve
            })
        )
        const getPersistence = vi.spyOn(client.kv, 'get')
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })

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
        const client = createFlagsClient()
        let resolveInitialization: (() => void) | undefined
        vi.spyOn(client.kv, 'initialize').mockReturnValue(
            new Promise<void>((resolve) => {
                resolveInitialization = resolve
            })
        )
        const registerProperties = vi.spyOn(client, 'registerDynamicEventProperties')
        const featureFlags = new SharedFeatureFlags({ get: () => createConfig() })

        const setup = featureFlags.setup(client)
        featureFlags.dispose()
        resolveInitialization?.()
        await setup

        expect(registerProperties).not.toHaveBeenCalled()
        expect(featureFlags.getFlagVariants()).toEqual({})
    })
})
