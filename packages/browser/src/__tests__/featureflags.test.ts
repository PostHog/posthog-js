import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'
import { BrowserClientAdapter } from '../extensions/browser-client'
import { MutableFeatureFlagsConfigSource } from '../feature-flags-config'
import { isNumber, isUndefined, MINIMAL_FLAG_CALLED_EVENT_CAMPAIGN_PROPERTIES } from '@posthog/core'
import { PostHogConfig } from '../types'
import { createMockPostHog, createPosthogInstance } from './helpers/posthog-instance'
import { SimpleEventEmitter } from '@posthog/browser-common/utils/simple-event-emitter'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { CAMPAIGN_PARAMS } from '@posthog/browser-common/utils/event-utils'
import { normalizeCaptureResult } from './helpers/normalize-capture-result'

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()),
    userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}))

vi.useFakeTimers()
vi.spyOn(global, 'setTimeout')

const expectedFeatureFlagDebugMessages = new Set([
    'All overrides cleared',
    'Flag overrides cleared',
    'Flag overrides set',
    'Payload overrides cleared',
    'Payload overrides set',
])

const mockExpectedFeatureFlagDebugLogs = (): void => {
    const failOnUnexpectedLog = console.log
    vi.spyOn(console, 'log').mockImplementation((...args) => {
        if (args[0] !== '[PostHog.js] [FeatureFlags]' || !expectedFeatureFlagDebugMessages.has(args[1])) {
            failOnUnexpectedLog(...args)
        }
    })
}

const createFeatureFlags = (instance: any): PostHogFeatureFlags => {
    instance.config.remote_config_refresh_interval_ms ??= 0
    instance._shouldDisableFlags ??= vi.fn(() => false)
    instance._registerExtensionEventProperties ??= vi.fn(() => () => {})
    instance.on ??= vi.fn(() => () => {})
    instance.sessionManager ??= {
        checkAndGetSessionAndWindowId: () => ({
            sessionId: instance.get_session_id?.() ?? '',
            windowId: '',
            sessionStartTimestamp: 0,
        }),
    }
    const configKey = () =>
        JSON.stringify({
            bootstrap: instance.config.bootstrap,
            advanced_disable_flags: instance.config.advanced_disable_flags,
            advanced_disable_decide: instance.config.advanced_disable_decide,
            advanced_disable_feature_flags: instance.config.advanced_disable_feature_flags,
            advanced_only_evaluate_survey_feature_flags: instance.config.advanced_only_evaluate_survey_feature_flags,
            advanced_feature_flags_dedup_per_session: instance.config.advanced_feature_flags_dedup_per_session,
            feature_flag_cache_ttl_ms: instance.config.feature_flag_cache_ttl_ms,
            remote_config_refresh_interval_ms: instance.config.remote_config_refresh_interval_ms,
            feature_flag_request_timeout_ms: instance.config.feature_flag_request_timeout_ms,
            feature_flag_request_max_retries: instance.config.feature_flag_request_max_retries,
            disable_compression: instance.config.disable_compression,
            evaluation_contexts: instance.config.evaluation_contexts,
            evaluation_environments: instance.config.evaluation_environments,
            flag_keys: instance.config.flag_keys,
        })
    const mutableSource = new MutableFeatureFlagsConfigSource(instance.config, instance._shouldDisableFlags())
    let lastConfigKey = configKey()
    const source = {
        get: () => {
            const nextConfigKey = configKey()
            if (lastConfigKey !== nextConfigKey) {
                mutableSource.update(instance.config, instance._shouldDisableFlags())
                lastConfigKey = nextConfigKey
            }
            return mutableSource.get()
        },
    }
    const featureFlags = new PostHogFeatureFlags(source)
    const client = new BrowserClientAdapter(instance)
    client.sendRequest = ((path: string, init: any = {}) => {
        let response: any
        let continuation: ((value: any) => void) | undefined
        let continuationError: unknown
        let errorHandler: ((error: unknown) => void) | undefined
        instance._send_request({
            method: init.method,
            url: instance.requestRouter.endpointFor(init.target ?? 'api', path),
            data: init.body,
            compression: init.compression,
            timestampMode: init.sentAt,
            timeout: init.timeoutMs,
            fireCallbackOnDrop: true,
            callback: (value: any) => {
                response = value
                if (continuation) {
                    try {
                        continuation(value)
                    } catch (error) {
                        continuationError = error
                        errorHandler?.(error)
                    }
                }
            },
        })
        const chained = {
            catch: (handler: (error: unknown) => void) => {
                errorHandler = handler
                if (continuationError) {
                    handler(continuationError)
                }
                return chained
            },
        }
        return {
            then: (handler: (value: any) => void) => {
                continuation = handler
                if (response) {
                    try {
                        handler(response)
                    } catch (error) {
                        continuationError = error
                    }
                }
                return chained
            },
        } as unknown as Promise<any>
    }) as BrowserClientAdapter['sendRequest']
    featureFlags.setup(client)
    featureFlags.onReloading(() => instance._internalEventEmitter?.emit('featureFlagsReloading', true))
    const register = instance.persistence?.register?.bind(instance.persistence)
    if (register) {
        instance.persistence.register = (properties: Record<string, unknown>) => {
            register(properties)
            ;(featureFlags as any)._rebuildEventProperties()
        }
    }
    if (instance.persistence) {
        let persistenceProps = instance.persistence.props
        Object.defineProperty(instance.persistence, 'props', {
            configurable: true,
            get: () => persistenceProps,
            set: (properties: Record<string, unknown>) => {
                persistenceProps = properties
                ;(featureFlags as any)._rebuildEventProperties()
            },
        })
    }
    const unregister = instance.persistence?.unregister?.bind(instance.persistence)
    if (unregister) {
        instance.persistence.unregister = (key: string) => {
            unregister(key)
            ;(featureFlags as any)._rebuildEventProperties()
        }
    }
    return featureFlags
}

describe('featureflags', () => {
    let instance
    let featureFlags

    const config = {
        token: 'random fake token',
        persistence: 'memory',
        api_host: 'https://app.posthog.com',
    } as PostHogConfig

    beforeEach(() => {
        window.POSTHOG_DEBUG = true
        mockExpectedFeatureFlagDebugLogs()

        const internalEventEmitter = new SimpleEventEmitter()
        instance = {
            config: { ...config },
            get_distinct_id: () => 'blah id',
            getGroups: () => {},
            persistence: new PostHogPersistence(config),
            requestRouter: new RequestRouter({ config } as any),
            register: (props) => instance.persistence.register(props),
            unregister: (key) => instance.persistence.unregister(key),
            get_property: (key) => instance.persistence.props[key],
            capture: () => {},
            flagsEndpointWasHit: false,
            _send_request: vi.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {},
                })
            ),
            _onRemoteConfig: vi.fn(),
            reloadFeatureFlags: () => featureFlags.reloadFeatureFlags(),
            _shouldDisableFlags: () =>
                instance.config.advanced_disable_flags || instance.config.advanced_disable_decide || false,
            _internalEventEmitter: internalEventEmitter,
            on: (event: string, cb: (...args: any[]) => void) => internalEventEmitter.on(event, cb),
        }

        featureFlags = createFeatureFlags(instance)

        vi.spyOn(instance, 'capture').mockReturnValue(undefined)
        vi.spyOn(window.console, 'warn').mockImplementation(() => {})

        instance.persistence.register({
            $feature_flag_payloads: {
                'beta-feature': {
                    some: 'payload',
                },
                'alpha-feature-2': 200,
            },
            $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
            $enabled_feature_flags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
                'disabled-flag': false,
            },
            $override_feature_flags: false,
        })

        instance.persistence.unregister('$flag_call_reported')
    })

    describe('_callFlagsEndpoint retries', () => {
        // 502/504 and timeouts get one more attempt by default. A plain status-0 does
        // not: in the browser that is usually a blocker or CORS, which the status-0
        // circuit breaker already handles.
        const timeoutError = () => Object.assign(new Error('timeout'), { name: 'AbortError' })

        const respondWith = (...responses: (number | { statusCode: number; error: Error })[]) => {
            let call = 0
            instance._send_request = vi.fn().mockImplementation(({ callback }) => {
                const next = responses[Math.min(call, responses.length - 1)]
                call++
                const { statusCode, error } = isNumber(next) ? { statusCode: next, error: undefined } : next
                callback({
                    statusCode,
                    error,
                    json: statusCode === 200 ? { featureFlags: { 'retried-flag': true } } : {},
                })
            })
        }

        const reloadAndSettle = async () => {
            featureFlags.reloadFeatureFlags()
            vi.runOnlyPendingTimers()
            await vi.advanceTimersByTimeAsync(1000)
        }

        it.each([
            ['HTTP 502', 502],
            ['HTTP 504', 504],
        ])('retries %s once and uses the successful retry', async (_label, failingStatus) => {
            respondWith(failingStatus, 200)

            await reloadAndSettle()

            expect(instance._send_request).toHaveBeenCalledTimes(2)
            expect(featureFlags.isFeatureEnabled('retried-flag')).toBe(true)
        })

        it('retries a timeout once and uses the successful retry', async () => {
            respondWith({ statusCode: 0, error: timeoutError() }, 200)

            await reloadAndSettle()

            expect(instance._send_request).toHaveBeenCalledTimes(2)
            expect(featureFlags.isFeatureEnabled('retried-flag')).toBe(true)
        })

        it('does not retry a plain status-0 failure, leaving it to the circuit breaker', async () => {
            respondWith(0, 200)

            await reloadAndSettle()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })

        it.each([
            ['HTTP 408', 408],
            ['HTTP 429', 429],
            ['HTTP 500', 500],
            ['HTTP 503', 503],
        ])('does not retry %s', async (_label, terminalStatus) => {
            respondWith(terminalStatus, 200)

            await reloadAndSettle()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('does not retry a successful response', async () => {
            respondWith(200)

            await reloadAndSettle()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('stops after the configured number of retries', async () => {
            instance.config.feature_flag_request_max_retries = 2
            respondWith(502)

            await reloadAndSettle()

            expect(instance._send_request).toHaveBeenCalledTimes(3)
        })

        it('cancels a delayed retry when disposed during backoff', async () => {
            respondWith(502, 200)
            featureFlags._callFlagsEndpoint()
            await vi.advanceTimersByTimeAsync(0)
            expect(instance._send_request).toHaveBeenCalledTimes(1)

            featureFlags.dispose()
            await vi.advanceTimersByTimeAsync(1000)

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect((featureFlags as any)._requestInFlight).toBe(false)
        })

        it.each(['advanced_disable_flags', 'advanced_disable_decide'] as const)(
            'cancels a delayed retry when %s is enabled during backoff',
            async (configKey) => {
                respondWith(502, 200)
                featureFlags._callFlagsEndpoint()
                await vi.advanceTimersByTimeAsync(0)
                expect(instance._send_request).toHaveBeenCalledTimes(1)

                instance.config[configKey] = true
                featureFlags.reloadFeatureFlags()
                await vi.advanceTimersByTimeAsync(1000)

                expect(instance._send_request).toHaveBeenCalledTimes(1)
                expect((featureFlags as any)._requestInFlight).toBe(false)

                instance.config[configKey] = false
                await reloadAndSettle()

                expect(instance._send_request).toHaveBeenCalledTimes(2)
                expect(featureFlags.isFeatureEnabled('retried-flag')).toBe(true)
            }
        )

        it('does not retry when feature_flag_request_max_retries is 0', async () => {
            instance.config.feature_flag_request_max_retries = 0
            respondWith(502, 200)

            await reloadAndSettle()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })
    })

    describe('_callFlagsEndpoint via reloadFeatureFlags', () => {
        it('omits invalid non-array flag_keys configuration from requests', () => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => {})
            instance.config.flag_keys = 'beta-feature' as any

            featureFlags.reloadFeatureFlags()
            vi.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data).not.toHaveProperty('flag_keys')
            expect(error).toHaveBeenCalledTimes(1)
        })

        it('should not call /flags if advanced_disable_decide is true', () => {
            instance.config.advanced_disable_decide = true
            featureFlags.reloadFeatureFlags()
            vi.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(0)
        })

        it('should not call /flags if advanced_disable_flags is true', () => {
            instance.config.advanced_disable_flags = true
            featureFlags.reloadFeatureFlags()
            vi.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(0)
        })

        it('should support deprecated evaluation_environments field', () => {
            instance.config.evaluation_environments = ['production', 'web']
            featureFlags.reloadFeatureFlags()
            vi.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.evaluation_contexts).toEqual(['production', 'web'])
        })
    })

    describe('featureFlagsReloading event', () => {
        beforeEach(() => {
            instance._send_request = vi.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {
                        featureFlags: {
                            first: 'variant-1',
                            second: true,
                        },
                    },
                })
            )
        })

        it('should emit featureFlagsReloading event when reloadFeatureFlags is called', () => {
            const loadingCallback = vi.fn()
            instance.on('featureFlagsReloading', loadingCallback)

            featureFlags.reloadFeatureFlags()

            expect(loadingCallback).toHaveBeenCalledTimes(1)
            expect(loadingCallback).toHaveBeenCalledWith(true)
        })

        it('should not emit featureFlagsReloading event if already debouncing', () => {
            const loadingCallback = vi.fn()
            instance.on('featureFlagsReloading', loadingCallback)

            featureFlags.reloadFeatureFlags()
            featureFlags.reloadFeatureFlags()
            featureFlags.reloadFeatureFlags()

            // Should only emit once because subsequent calls are debounced
            expect(loadingCallback).toHaveBeenCalledTimes(1)
        })

        it('should emit featureFlagsReloading before onFeatureFlags callback', async () => {
            const callOrder: string[] = []

            instance.on('featureFlagsReloading', () => {
                callOrder.push('loading')
            })

            featureFlags.onFeatureFlags(() => {
                callOrder.push('loaded')
            })

            featureFlags.reloadFeatureFlags()
            await vi.runAllTimersAsync()

            expect(callOrder).toEqual(['loading', 'loaded'])
        })

        it('should not emit featureFlagsReloading if reloading is disabled', () => {
            const loadingCallback = vi.fn()
            instance.on('featureFlagsReloading', loadingCallback)

            featureFlags.setReloadingPaused(true)
            featureFlags.reloadFeatureFlags()

            expect(loadingCallback).not.toHaveBeenCalled()
        })

        it('should not emit featureFlagsReloading if feature flags are disabled', () => {
            const loadingCallback = vi.fn()
            instance.on('featureFlagsReloading', loadingCallback)

            instance.config.advanced_disable_feature_flags = true
            featureFlags.reloadFeatureFlags()

            expect(loadingCallback).not.toHaveBeenCalled()
        })
    })

    describe('earlyAccessFeatures', () => {
        afterEach(() => {
            instance.persistence.clear()
        })
        // actually early access feature response
        const EARLY_ACCESS_FEATURE_FIRST = {
            name: 'first',
            description: 'first description',
            stage: 'alpha',
            imageUrl: null,
            documentationUrl: 'http://example.com',
            flagKey: 'first-flag',
        }

        beforeEach(() => {
            instance._send_request = vi.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {
                        earlyAccessFeatures: [EARLY_ACCESS_FEATURE_FIRST],
                    },
                })
            )
        })

        it('getEarlyAccessFeatures handles persistence absence gracefully', () => {
            // Save original get_property function
            const originalGetProperty = instance.get_property

            // Remove persistence and update get_property to handle undefined persistence
            instance.persistence = undefined
            instance.get_property = (key) => {
                if (!instance.persistence) {
                    return undefined
                }
                return originalGetProperty.call(instance, key)
            }

            // Should not throw error
            expect(() => {
                featureFlags.getEarlyAccessFeatures((data) => {
                    expect(data).toEqual([EARLY_ACCESS_FEATURE_FIRST])
                }, true)
            }).not.toThrow()

            expect(instance._send_request).toHaveBeenCalled()

            // Restore persistence for afterEach cleanup
            instance.persistence = {
                props: {},
                register: vi.fn(),
                unregister: vi.fn(),
                clear: vi.fn(),
            }
        })
    })

    describe('device_id in flags requests', () => {
        beforeEach(() => {
            // Clear persistence before each test in this suite
            instance.persistence.unregister('$device_id')
            instance.persistence.unregister('$stored_person_properties')
            instance.persistence.unregister('$stored_group_properties')

            instance._send_request = vi.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {
                        featureFlags: {
                            first: 'variant-1',
                            second: true,
                        },
                    },
                })
            )
        })

        afterEach(() => {
            // Clean up after each test
            instance.persistence.unregister('$device_id')
            instance.persistence.unregister('$stored_person_properties')
            instance.persistence.unregister('$stored_group_properties')
        })

        it('should omit device_id when it is null (cookieless mode)', () => {
            instance.persistence.register({
                $device_id: null,
            })

            featureFlags.reloadFeatureFlags()
            vi.runAllTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: undefined,
                group_properties: undefined,
                person_properties: {
                    $lib: 'web',
                    $lib_version: expect.any(String),
                },
                timezone: expect.any(String),
            })
            expect(instance._send_request.mock.calls[0][0].data).not.toHaveProperty('$device_id')
        })
    })

    describe('minimal flag called events gate persistence', () => {
        const receiveFlags = (response: Record<string, any>) => {
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                flags: {
                    'test-flag': {
                        key: 'test-flag',
                        enabled: true,
                        variant: undefined,
                        reason: undefined,
                        metadata: undefined,
                    },
                },
                ...response,
            })
        }

        it('persists the gate from the flags response and never exposes it as an event property', () => {
            receiveFlags({ minimalFlagCalledEvents: true })

            expect(instance.persistence.props['$minimal_flag_called_events']).toBe(true)
            expect(instance.persistence.properties()).not.toHaveProperty('$minimal_flag_called_events')
        })
    })
})

describe('getRemoteConfigPayload', () => {
    let instance: PostHog
    let featureFlags: PostHogFeatureFlags

    beforeEach(() => {
        window.POSTHOG_DEBUG = true
        instance = createMockPostHog({
            config: {
                token: 'test-token',
                api_host: 'https://test.com',
            } as PostHogConfig,
            get_distinct_id: () => 'test-distinct-id',
            _send_request: vi.fn(),
            requestRouter: {
                endpointFor: vi.fn().mockImplementation((endpoint, path) => `${endpoint}${path}`),
            },
        })

        featureFlags = createFeatureFlags(instance)
    })

    it('should support deprecated evaluation_environments field', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        instance.config.evaluation_environments = ['staging', 'backend']

        const callback = vi.fn()
        featureFlags.getRemoteConfigPayload('test-flag', callback)

        expect(warnSpy).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringContaining('evaluation_environments is deprecated')
        )

        expect(instance._send_request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'POST',
                url: 'flags/flags/?v=2',
                data: expect.objectContaining({
                    distinct_id: 'test-distinct-id',
                    token: 'test-token',
                    evaluation_contexts: ['staging', 'backend'],
                }),
            })
        )

        warnSpy.mockRestore()
    })

    describe('flags_api_host configuration', () => {
        it('should use flags_api_host when configured', () => {
            const apiConfig = {
                api_host: 'https://app.posthog.com',
                flags_api_host: 'https://example.com/feature-flags',
            }
            const customInstance = createMockPostHog({
                config: {
                    token: 'test-token',
                    ...apiConfig,
                } as PostHogConfig,
                get_distinct_id: () => 'test-distinct-id',
                _send_request: vi.fn(),
                requestRouter: new RequestRouter({ config: apiConfig } as any),
            })

            const customFeatureFlags = createFeatureFlags(customInstance)
            const callback = vi.fn()
            customFeatureFlags.getRemoteConfigPayload('test-flag', callback)

            expect(customInstance._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'POST',
                    url: 'https://example.com/feature-flags/flags/?v=2',
                })
            )
        })

        it('should fall back to api_host when flags_api_host is not configured', () => {
            const customInstance = createMockPostHog({
                config: {
                    token: 'test-token',
                    api_host: 'https://app.posthog.com',
                } as PostHogConfig,
                get_distinct_id: () => 'test-distinct-id',
                _send_request: vi.fn(),
                requestRouter: new RequestRouter({
                    config: {
                        api_host: 'https://app.posthog.com',
                    },
                } as any),
            })

            const customFeatureFlags = createFeatureFlags(customInstance)
            const callback = vi.fn()
            customFeatureFlags.getRemoteConfigPayload('test-flag', callback)

            expect(customInstance._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'POST',
                    url: 'https://us.i.posthog.com/flags/?v=2',
                })
            )
        })
    })
})

describe('updateFlags', () => {
    beforeEach(() => {
        vi.spyOn(window.console, 'warn').mockImplementation(() => {})
    })

    it('reports the same flag value again after identify', async () => {
        const posthog = await createPosthogInstance()
        const capture = vi.spyOn(posthog, 'capture')
        posthog.updateFlags({ 'test-flag': true })

        posthog.getFeatureFlag('test-flag')
        posthog.identify('identified-user')
        posthog.getFeatureFlag('test-flag')

        expect(capture.mock.calls.filter(([event]) => event === '$feature_flag_called')).toHaveLength(2)
    })

    it('should work with advanced_disable_flags enabled', async () => {
        const posthog = await createPosthogInstance(undefined, {
            advanced_disable_flags: true,
        })

        posthog.updateFlags({ 'test-flag': true })

        expect(posthog.isFeatureEnabled('test-flag')).toBe(true)
    })
})

describe('minimal $feature_flag_called events', () => {
    beforeEach(() => {
        // Events are dropped via before_send (expected warn) and bootstrap flags go through
        // the legacy-shape path (expected upgrade warn).
        vi.spyOn(window.console, 'warn').mockImplementation(() => {})
        vi.spyOn(window.console, 'error').mockImplementation(() => {})
    })

    const gatedFlagsResponse = (options: { minimalFlagCalledEvents?: boolean; hasExperiment?: boolean } = {}) => ({
        flags: {
            'test-flag': {
                key: 'test-flag',
                enabled: true,
                variant: undefined,
                reason: undefined,
                metadata: {
                    id: 42,
                    version: 3,
                    description: undefined,
                    payload: undefined,
                    ...(isUndefined(options.hasExperiment) ? {} : { has_experiment: options.hasExperiment }),
                },
            },
        },
        requestId: 'minimal-request-id',
        evaluatedAt: 1700000000000,
        ...(isUndefined(options.minimalFlagCalledEvents)
            ? {}
            : { minimalFlagCalledEvents: options.minimalFlagCalledEvents }),
    })

    const createInstanceWithCapturedEvents = async (config: Record<string, any> = {}, token?: string) => {
        const events: any[] = []
        const posthog = await createPosthogInstance(token, {
            advanced_disable_feature_flags: true,
            before_send: (event) => {
                events.push(event)
                return null
            },
            ...config,
        })
        return { posthog, events }
    }

    const findFlagCalledEvent = (events: any[]) => events.find((e) => e.event === '$feature_flag_called')

    it('sends exactly the allowlisted properties when gated and the flag has no experiment', async () => {
        const { posthog, events } = await createInstanceWithCapturedEvents({}, 'minimal-flag-snapshot-token')
        // Super properties must be structurally excluded from the minimal event
        posthog.register({ super_prop: 'super_value' })
        // $groups must survive minimization — it feeds ingestion dedup and group-flag routing
        posthog.group('organization', 'org-1')
        posthog.featureFlags.receivedFeatureFlags(
            gatedFlagsResponse({ minimalFlagCalledEvents: true, hasExperiment: false })
        )

        expect(posthog.getFeatureFlag('test-flag')).toBe(true)

        const event = findFlagCalledEvent(events)
        expect(event).toBeDefined()
        expect(Object.keys(event.properties).sort()).toEqual(
            [
                // transport-level keys the browser SDK carries inside properties
                'token',
                'distinct_id',
                // the strict allowlist
                '$feature_flag',
                '$feature_flag_response',
                '$feature_flag_has_experiment',
                '$feature_flag_id',
                '$feature_flag_version',
                '$feature_flag_request_id',
                '$feature_flag_evaluated_at',
                '$groups',
                '$current_url',
                '$pathname',
                // session-level attribution props survive minimization so a flag-called
                // event firing first doesn't null out the session's UTM/channel
                '$referring_domain',
                '$session_id',
                '$window_id',
                '$lib',
                '$lib_version',
                '$device_id',
                '$process_person_profile',
            ].sort()
        )
        expect(event.properties).toMatchObject({
            $feature_flag: 'test-flag',
            $feature_flag_response: true,
            $feature_flag_has_experiment: false,
            $feature_flag_id: 42,
            $feature_flag_version: 3,
            $feature_flag_request_id: 'minimal-request-id',
            $feature_flag_evaluated_at: 1700000000000,
            $groups: { organization: 'org-1' },
        })
        expect(event.$set_once).toBeUndefined()
        expect(
            normalizeCaptureResult(event, ['distinct_id', '$device_id', '$session_id', '$window_id', '$lib_version'])
        ).toMatchSnapshot()
    })

    it('keeps every canonical session-attribution campaign param without widening the minimal event', async () => {
        const { posthog, events } = await createInstanceWithCapturedEvents()
        const campaignProperties = Object.fromEntries(CAMPAIGN_PARAMS.map((key) => [key, `value-for-${key}`]))

        // Keep the shared minimal-event set exhaustively synchronized with the canonical
        // browser campaign set without copying that list into this test.
        expect(MINIMAL_FLAG_CALLED_EVENT_CAMPAIGN_PROPERTIES).toEqual(CAMPAIGN_PARAMS)

        posthog.register({
            ...campaignProperties,
            $referring_domain: 'referring.example',
            $referrer: 'https://referring.example/path?private=value',
            unrelated_superproperty: 'must-be-stripped',
        })
        posthog.featureFlags.receivedFeatureFlags(
            gatedFlagsResponse({ minimalFlagCalledEvents: true, hasExperiment: false })
        )

        expect(posthog.getFeatureFlag('test-flag')).toBe(true)

        const event = findFlagCalledEvent(events)
        expect(event).toBeDefined()
        expect(event.properties).toMatchObject({
            ...campaignProperties,
            $referring_domain: 'referring.example',
        })
        expect(event.properties).not.toHaveProperty('$referrer')
        expect(event.properties).not.toHaveProperty('unrelated_superproperty')
    })

    it('strips the timestamp-override props when captured with an explicit timestamp', async () => {
        const { posthog, events } = await createInstanceWithCapturedEvents()
        posthog.featureFlags.receivedFeatureFlags(
            gatedFlagsResponse({ minimalFlagCalledEvents: true, hasExperiment: false })
        )

        const overrideTimestamp = new Date(Date.now() - 1000)
        posthog.capture(
            '$feature_flag_called',
            { $feature_flag: 'test-flag', $feature_flag_response: true, $feature_flag_has_experiment: false },
            { timestamp: overrideTimestamp }
        )

        const event = findFlagCalledEvent(events)
        expect(event).toBeDefined()
        expect(event.properties).not.toHaveProperty('$event_time_override_provided')
        expect(event.properties).not.toHaveProperty('$event_time_override_system_time')
        expect(Object.keys(event.properties).sort()).toEqual(
            [
                'token',
                'distinct_id',
                '$feature_flag',
                '$feature_flag_response',
                '$feature_flag_has_experiment',
                '$feature_flag_request_id',
                '$current_url',
                '$pathname',
                '$referring_domain',
                '$session_id',
                '$window_id',
                '$lib',
                '$lib_version',
                '$device_id',
                '$process_person_profile',
            ].sort()
        )
        // The transport-level timestamp itself is untouched by minimization
        expect(event.timestamp).toEqual(overrideTimestamp)
    })

    it('sends the full event when gated but the flag has an experiment', async () => {
        const { posthog, events } = await createInstanceWithCapturedEvents({}, 'full-flag-snapshot-token')
        posthog.register({ super_prop: 'super_value' })
        posthog.featureFlags.receivedFeatureFlags(
            gatedFlagsResponse({ minimalFlagCalledEvents: true, hasExperiment: true })
        )

        posthog.getFeatureFlag('test-flag')

        const event = findFlagCalledEvent(events)
        expect(event.properties).toMatchObject({
            $feature_flag_has_experiment: true,
            super_prop: 'super_value',
            '$feature/test-flag': true,
            $active_feature_flags: ['test-flag'],
            $used_bootstrap_value: expect.any(Boolean),
        })
        expect(normalizeCaptureResult(event)).toMatchSnapshot()
    })

    it.each([
        ['the gate field is absent', gatedFlagsResponse({ hasExperiment: false })],
        ['the gate field is false', gatedFlagsResponse({ minimalFlagCalledEvents: false, hasExperiment: false })],
        ['has_experiment is absent', gatedFlagsResponse({ minimalFlagCalledEvents: true })],
    ])('sends the full event when %s', async (_, response) => {
        const { posthog, events } = await createInstanceWithCapturedEvents()
        posthog.register({ super_prop: 'super_value' })
        posthog.featureFlags.receivedFeatureFlags(response)

        posthog.getFeatureFlag('test-flag')

        const event = findFlagCalledEvent(events)
        expect(event.properties).toMatchObject({
            super_prop: 'super_value',
            '$feature/test-flag': true,
        })
    })

    it('sends the full event for bootstrap-only flags (no gate until a real flags response)', async () => {
        const { posthog, events } = await createInstanceWithCapturedEvents({
            bootstrap: { featureFlags: { 'test-flag': true } },
        })

        posthog.getFeatureFlag('test-flag')

        const event = findFlagCalledEvent(events)
        expect(event.properties).toMatchObject({
            $feature_flag: 'test-flag',
            $used_bootstrap_value: true,
            '$feature/test-flag': true,
        })
    })

    it('keeps sending minimal events after a reload backed by the same persistence', async () => {
        const persistenceName = `reload-test-${uuidv7()}`
        const { posthog: firstInstance } = await createInstanceWithCapturedEvents({
            persistence: 'localstorage',
            persistence_name: persistenceName,
        })
        // First page load receives the gated flags but never evaluates them.
        firstInstance.featureFlags.receivedFeatureFlags(
            gatedFlagsResponse({ minimalFlagCalledEvents: true, hasExperiment: false })
        )

        // Simulated reload: fresh instance backed by the same persisted state, no flags response.
        const events: any[] = []
        const reloadedInstance = await createPosthogInstance(undefined, {
            persistence: 'localstorage',
            persistence_name: persistenceName,
            advanced_disable_feature_flags: true,
            before_send: (event) => {
                events.push(event)
                return null
            },
        })

        expect(reloadedInstance.getFeatureFlag('test-flag')).toBe(true)

        const event = findFlagCalledEvent(events)
        expect(event).toBeDefined()
        expect(event.properties.$feature_flag_has_experiment).toBe(false)
        expect(event.properties).not.toHaveProperty('$feature/test-flag')
        expect(event.properties).not.toHaveProperty('$active_feature_flags')
        expect(event.properties).not.toHaveProperty('$used_bootstrap_value')
        expect(event.properties).not.toHaveProperty('$browser')
    })
})
