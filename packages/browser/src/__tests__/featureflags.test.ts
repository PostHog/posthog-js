/*eslint @typescript-eslint/no-empty-function: "off" */

import {
    filterActiveFeatureFlags,
    parseFlagsResponse,
    PostHogFeatureFlags,
    FeatureFlagError,
} from '../posthog-featureflags'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'
import { PostHogConfig } from '../types'
import { createMockPostHog, createPosthogInstance } from './helpers/posthog-instance'
import { SimpleEventEmitter } from '../utils/simple-event-emitter'

jest.useFakeTimers()
jest.spyOn(global, 'setTimeout')

describe('featureflags', () => {
    let instance
    let featureFlags

    const config = {
        token: 'random fake token',
        persistence: 'memory',
        api_host: 'https://app.posthog.com',
    } as PostHogConfig

    let mockWarn

    beforeEach(() => {
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
            _send_request: jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {},
                })
            ),
            _onRemoteConfig: jest.fn(),
            reloadFeatureFlags: () => featureFlags.reloadFeatureFlags(),
            _shouldDisableFlags: () =>
                instance.config.advanced_disable_flags || instance.config.advanced_disable_decide || false,
            _internalEventEmitter: internalEventEmitter,
            on: (event: string, cb: (...args: any[]) => void) => internalEventEmitter.on(event, cb),
        }

        featureFlags = new PostHogFeatureFlags(instance)

        jest.spyOn(instance, 'capture').mockReturnValue(undefined)
        mockWarn = jest.spyOn(window.console, 'warn').mockImplementation()

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

    it('should return flags from persistence even if /flags endpoint was not hit', () => {
        featureFlags._hasLoadedFlags = false

        expect(featureFlags.getFlags()).toEqual([
            'beta-feature',
            'alpha-feature-2',
            'multivariate-flag',
            'disabled-flag',
        ])
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
    })

    it('should return flag details from persistence even if /flags endpoint was not hit', () => {
        instance.persistence.register({
            $feature_flag_details: {
                'beta-feature': {
                    key: 'beta-feature',
                    enabled: true,
                    variant: 'beta-variant-1',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 4,
                        payload: { payload: 'test' },
                        id: 1,
                        description: 'test-description',
                    },
                },
            },
            $override_feature_flags: false,
        })
        featureFlags._hasLoadedFlags = false

        expect(featureFlags.getFlagsWithDetails()).toEqual({
            'beta-feature': {
                key: 'beta-feature',
                enabled: true,
                variant: 'beta-variant-1',
                reason: {
                    code: 'test-reason',
                    condition_index: 1,
                    description: undefined,
                },
                metadata: {
                    version: 4,
                    payload: { payload: 'test' },
                    id: 1,
                    description: 'test-description',
                },
            },
        })
    })

    it('should warn if /flags endpoint was not hit and no flags exist', () => {
        ;(window as any).POSTHOG_DEBUG = true
        featureFlags._hasLoadedFlags = false
        instance.persistence.unregister('$enabled_feature_flags')
        instance.persistence.unregister('$active_feature_flags')

        expect(featureFlags.getFlags()).toEqual([])
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(undefined)
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'isFeatureEnabled for key "beta-feature" failed. Feature flags didn\'t load in time.'
        )

        mockWarn.mockClear()

        expect(featureFlags.getFeatureFlag('beta-feature')).toEqual(undefined)
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'getFeatureFlag for key "beta-feature" failed. Feature flags didn\'t load in time.'
        )
    })

    describe('fresh option', () => {
        it('should return undefined when fresh: true and flags have not been loaded from remote', () => {
            // Flags exist in persistence (from previous session)
            featureFlags._hasLoadedFlags = true
            // But they haven't been loaded from the server yet
            featureFlags._flagsLoadedFromRemote = false

            expect(featureFlags.getFeatureFlag('beta-feature')).toEqual(true)
            expect(featureFlags.getFeatureFlag('beta-feature', { fresh: true })).toEqual(undefined)

            expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
            expect(featureFlags.isFeatureEnabled('beta-feature', { fresh: true })).toEqual(undefined)

            expect(featureFlags.getFeatureFlagResult('beta-feature')).toEqual({
                key: 'beta-feature',
                enabled: true,
                variant: undefined,
                payload: { some: 'payload' },
            })
            expect(featureFlags.getFeatureFlagResult('beta-feature', { fresh: true })).toEqual(undefined)
        })

        it('should return flag value when fresh: true and flags have been loaded from remote', () => {
            featureFlags._hasLoadedFlags = true
            featureFlags._flagsLoadedFromRemote = true

            expect(featureFlags.getFeatureFlag('beta-feature', { fresh: true })).toEqual(true)
            expect(featureFlags.isFeatureEnabled('beta-feature', { fresh: true })).toEqual(true)
            expect(featureFlags.getFeatureFlagResult('beta-feature', { fresh: true })).toEqual({
                key: 'beta-feature',
                enabled: true,
                variant: undefined,
                payload: { some: 'payload' },
            })
        })

        it('should return undefined for fresh: true when only localStorage cache exists', () => {
            // Simulate: flags exist in localStorage from previous session
            // but no network request has completed yet
            featureFlags._hasLoadedFlags = false
            featureFlags._flagsLoadedFromRemote = false

            // Without fresh option, cached values are returned
            expect(featureFlags.getFeatureFlag('beta-feature')).toEqual(true)

            // With fresh option, undefined is returned
            expect(featureFlags.getFeatureFlag('beta-feature', { fresh: true })).toEqual(undefined)
        })
    })

    it('should return the right feature flag and call capture', () => {
        featureFlags._hasLoadedFlags = false

        expect(featureFlags.getFlags()).toEqual([
            'beta-feature',
            'alpha-feature-2',
            'multivariate-flag',
            'disabled-flag',
        ])
        expect(featureFlags.getFlagVariants()).toEqual({
            'alpha-feature-2': true,
            'beta-feature': true,
            'multivariate-flag': 'variant-1',
            'disabled-flag': false,
        })
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(featureFlags.isFeatureEnabled('random')).toEqual(undefined)
        expect(featureFlags.isFeatureEnabled('multivariate-flag')).toEqual(true)

        expect(instance.capture).toHaveBeenCalledTimes(3)

        // It should not call `capture` on subsequent calls
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(instance.capture).toHaveBeenCalledTimes(3)
        expect(instance.get_property('$flag_call_reported')).toEqual({
            'beta-feature': ['true'],
            'multivariate-flag': ['variant-1'],
            random: ['undefined'],
        })
    })

    it('should call capture for every different flag response', () => {
        featureFlags._hasLoadedFlags = true

        instance.persistence.register({
            $enabled_feature_flags: {
                'beta-feature': true,
            },
        })
        expect(featureFlags.getFlags()).toEqual(['beta-feature'])
        expect(featureFlags.getFlagVariants()).toEqual({
            'beta-feature': true,
        })
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)

        expect(instance.get_property('$flag_call_reported')).toEqual({ 'beta-feature': ['true'] })

        expect(instance.capture).toHaveBeenCalledTimes(1)

        // It should not call `capture` on subsequent calls
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(instance.capture).toHaveBeenCalledTimes(1)

        instance.persistence.register({
            $enabled_feature_flags: {},
        })
        featureFlags._hasLoadedFlags = false
        expect(featureFlags.getFlagVariants()).toEqual({})
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(undefined)
        // no extra capture call because flags haven't loaded yet.
        expect(instance.capture).toHaveBeenCalledTimes(1)

        featureFlags._hasLoadedFlags = true
        instance.persistence.register({
            $enabled_feature_flags: { x: 'y' },
        })
        expect(featureFlags.getFlagVariants()).toEqual({ x: 'y' })
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(undefined)
        expect(instance.capture).toHaveBeenCalledTimes(2)

        instance.persistence.register({
            $enabled_feature_flags: {
                'beta-feature': 'variant-1',
            },
        })
        expect(featureFlags.getFlagVariants()).toEqual({ 'beta-feature': 'variant-1' })
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(instance.capture).toHaveBeenCalledTimes(3)

        expect(instance.get_property('$flag_call_reported')).toEqual({
            'beta-feature': ['true', 'undefined', 'variant-1'],
        })
    })

    it('should return the right feature flag and not call capture', () => {
        featureFlags._hasLoadedFlags = true

        expect(featureFlags.isFeatureEnabled('beta-feature', { send_event: false })).toEqual(true)
        expect(instance.capture).not.toHaveBeenCalled()
    })

    it('should return the right payload', () => {
        expect(featureFlags.getFeatureFlagPayload('beta-feature')).toEqual({
            some: 'payload',
        })
        expect(featureFlags.getFeatureFlagPayload('alpha-feature-2')).toEqual(200)
        expect(featureFlags.getFeatureFlagPayload('multivariate-flag')).toEqual(undefined)
        expect(instance.capture).not.toHaveBeenCalled()
    })

    it('returns undefined for non-existent or disabled flags', () => {
        featureFlags._hasLoadedFlags = true

        expect(featureFlags.isFeatureEnabled('non-existent-flag')).toEqual(undefined)

        // Despite being non-existent, the event will still be captured
        expect(instance.capture).toHaveBeenCalled()
    })

    describe('getFeatureFlagResult', () => {
        it('should return the result with flag value and payload for boolean flags', () => {
            featureFlags._hasLoadedFlags = true

            const result = featureFlags.getFeatureFlagResult('beta-feature')

            expect(result).toEqual({
                key: 'beta-feature',
                enabled: true,
                variant: undefined,
                payload: { some: 'payload' },
            })
            expect(instance.capture).toHaveBeenCalledWith('$feature_flag_called', expect.any(Object))
        })

        it('should return the result with variant for multivariate flags', () => {
            featureFlags._hasLoadedFlags = true

            const result = featureFlags.getFeatureFlagResult('multivariate-flag')

            expect(result).toEqual({
                key: 'multivariate-flag',
                enabled: true,
                variant: 'variant-1',
                payload: undefined,
            })
            expect(instance.capture).toHaveBeenCalled()
        })

        it('should return undefined for non-existent flags', () => {
            featureFlags._hasLoadedFlags = true

            const result = featureFlags.getFeatureFlagResult('non-existent-flag')

            expect(result).toEqual(undefined)
        })

        it('should return result with enabled false for disabled flags', () => {
            featureFlags._hasLoadedFlags = true

            const result = featureFlags.getFeatureFlagResult('disabled-flag')

            expect(result).toEqual({
                key: 'disabled-flag',
                enabled: false,
                variant: undefined,
                payload: undefined,
            })
        })

        it('should respect send_event option', () => {
            featureFlags._hasLoadedFlags = true

            const result = featureFlags.getFeatureFlagResult('beta-feature', { send_event: false })

            expect(result).toEqual({
                key: 'beta-feature',
                enabled: true,
                variant: undefined,
                payload: { some: 'payload' },
            })
            expect(instance.capture).not.toHaveBeenCalled()
        })

        it('should return raw string payload when JSON parsing fails', () => {
            featureFlags._hasLoadedFlags = true
            instance.persistence.register({
                $feature_flag_payloads: {
                    'invalid-json-flag': 'not valid json {{{',
                },
                $enabled_feature_flags: {
                    'invalid-json-flag': true,
                },
            })

            const result = featureFlags.getFeatureFlagResult('invalid-json-flag', { send_event: false })

            expect(result).toEqual({
                key: 'invalid-json-flag',
                enabled: true,
                variant: undefined,
                payload: 'not valid json {{{',
            })
        })

        it('should return override result when flag is overridden', () => {
            instance.__loaded = true
            featureFlags._hasLoadedFlags = true
            featureFlags.overrideFeatureFlags({
                flags: { 'overridden-flag': 'override-variant' },
                payloads: { 'overridden-flag': { custom: 'payload' } },
                suppressWarning: true,
            })

            const result = featureFlags.getFeatureFlagResult('overridden-flag', { send_event: false })

            expect(result).toEqual({
                key: 'overridden-flag',
                enabled: true,
                variant: 'override-variant',
                payload: { custom: 'payload' },
            })
        })

        it('should return disabled result when flag is overridden to false', () => {
            instance.__loaded = true
            featureFlags._hasLoadedFlags = true
            featureFlags.overrideFeatureFlags({
                flags: { 'disabled-override-flag': false },
                suppressWarning: true,
            })

            const result = featureFlags.getFeatureFlagResult('disabled-override-flag', { send_event: false })

            expect(result).toEqual({
                key: 'disabled-override-flag',
                enabled: false,
                variant: undefined,
                payload: undefined,
            })
        })

        it('should return payload even when flag is overridden to false', () => {
            instance.__loaded = true
            featureFlags._hasLoadedFlags = true
            featureFlags.overrideFeatureFlags({
                flags: { 'disabled-with-payload': false },
                payloads: { 'disabled-with-payload': { some: 'data' } },
                suppressWarning: true,
            })

            const result = featureFlags.getFeatureFlagResult('disabled-with-payload', { send_event: false })

            expect(result).toEqual({
                key: 'disabled-with-payload',
                enabled: false,
                variant: undefined,
                payload: { some: 'data' },
            })
        })

        it('should return disabled result when flag is overridden to undefined', () => {
            instance.__loaded = true
            featureFlags._hasLoadedFlags = true
            featureFlags.overrideFeatureFlags({
                flags: { 'undefined-override-flag': undefined as any },
                suppressWarning: true,
            })

            const result = featureFlags.getFeatureFlagResult('undefined-override-flag', { send_event: false })

            expect(result).toEqual({
                key: 'undefined-override-flag',
                enabled: false,
                variant: undefined,
                payload: undefined,
            })
        })
    })

    describe('feature flag overrides', () => {
        beforeEach(() => {
            // Common setup used across multiple tests
            instance.__loaded = true
            instance.persistence.props = {
                $active_feature_flags: ['beta-feature', 'alpha-feature-2'],
                $enabled_feature_flags: {
                    'beta-feature': true,
                    'alpha-feature-2': true,
                },
                $feature_flag_payloads: {
                    'beta-feature': { original: 'payload' },
                    'alpha-feature-2': 123,
                },
            }
        })

        describe('deprecated override method', () => {
            it('supports basic flag overrides with warning behavior', () => {
                // Test default warning behavior
                featureFlags.override({
                    'beta-feature': false,
                })

                expect(featureFlags.getFlagVariants()).toEqual({
                    'beta-feature': false,
                    'alpha-feature-2': true,
                })
                expect(window.console.warn).toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!',
                    expect.any(Object)
                )

                // Test suppressed warning behavior
                mockWarn.mockClear()
                featureFlags.override(
                    {
                        'alpha-feature-2': false,
                    },
                    { suppressWarning: true }
                )

                expect(window.console.warn).not.toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!'
                )
                expect(featureFlags.getFlagVariants()).toEqual({
                    'beta-feature': true,
                    'alpha-feature-2': false,
                })
            })

            it('shows deprecation warning', () => {
                featureFlags.override({ 'beta-feature': false })
                expect(window.console.warn).toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    'override is deprecated. Please use overrideFeatureFlags instead.'
                )
            })
        })

        describe('new overrideFeatureFlags method', () => {
            it('supports basic flag overrides with warning behavior', () => {
                // Test default warning behavior
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'beta-feature': false,
                    },
                })

                expect(featureFlags.getFlagVariants()).toEqual({
                    'beta-feature': false,
                    'alpha-feature-2': true,
                })
                expect(window.console.warn).toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!',
                    expect.any(Object)
                )

                // Test suppressed warning behavior
                mockWarn.mockClear()
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'alpha-feature-2': false,
                    },
                    suppressWarning: true,
                })

                expect(window.console.warn).not.toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!'
                )
                expect(featureFlags.getFlagVariants()).toEqual({
                    'beta-feature': true,
                    'alpha-feature-2': false,
                })
            })

            it('supports basic flag details overrides with warning behavior', () => {
                instance.persistence.props = {
                    $feature_flag_details: {
                        'beta-feature': {
                            key: 'beta-feature',
                            enabled: true,
                            variant: 'beta-variant-1',
                            reason: {
                                code: 'test-reason',
                                condition_index: 1,
                                description: undefined,
                            },
                            metadata: undefined,
                        },
                        'alpha-feature-2': {
                            key: 'alpha-feature-2',
                            enabled: true,
                            variant: undefined,
                            reason: undefined,
                            metadata: { payload: 200 },
                        },
                    },
                }

                // Test default warning behavior
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'beta-feature': false,
                    },
                })

                expect(featureFlags.getFeatureFlagDetails('beta-feature')).toEqual({
                    key: 'beta-feature',
                    enabled: false,
                    original_enabled: true,
                    variant: undefined,
                    original_variant: 'beta-variant-1',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: undefined,
                })
                expect(window.console.warn).toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!',
                    expect.any(Object)
                )

                // Test suppressed warning behavior
                mockWarn.mockClear()
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'alpha-feature-2': false,
                    },
                    suppressWarning: true,
                })

                expect(window.console.warn).not.toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flags!'
                )
                expect(featureFlags.getFeatureFlagDetails('alpha-feature-2')).toEqual({
                    key: 'alpha-feature-2',
                    enabled: false,
                    original_enabled: true,
                    variant: undefined,
                    reason: undefined,
                    metadata: { payload: 200 },
                })
            })

            it('supports payload overrides', () => {
                // Test with warning suppressed
                featureFlags.overrideFeatureFlags({
                    payloads: {
                        'beta-feature': { data: 'overridden' },
                        'alpha-feature-2': 456,
                    },
                    suppressWarning: true,
                })

                expect(featureFlags.getFlagPayloads()).toEqual({
                    'beta-feature': { data: 'overridden' },
                    'alpha-feature-2': 456,
                })

                expect(window.console.warn).not.toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flag payloads!'
                )

                // Test without suppressing warning
                featureFlags.overrideFeatureFlags({
                    payloads: {
                        'beta-feature': { data: 'overridden-again' },
                    },
                    suppressWarning: false,
                })

                expect(featureFlags.getFlagPayloads()).toEqual({
                    'beta-feature': { data: 'overridden-again' },
                    'alpha-feature-2': 123,
                })
                expect(window.console.warn).toHaveBeenCalledWith(
                    '[PostHog.js] [FeatureFlags]',
                    ' Overriding feature flag payloads!',
                    expect.any(Object)
                )
            })

            it('supports payload overrides with details', () => {
                instance.persistence.props = {
                    $feature_flag_details: {
                        'beta-feature': {
                            key: 'beta-feature',
                            enabled: true,
                            variant: 'beta-variant-1',
                            reason: {
                                code: 'test-reason',
                                condition_index: 1,
                                description: undefined,
                            },
                            metadata: {
                                version: 4,
                                payload: { payload: 'test' },
                                id: 1,
                                description: 'test-description',
                            },
                        },
                    },
                }

                featureFlags.overrideFeatureFlags({
                    payloads: {
                        'beta-feature': { data: 'overridden' },
                    },
                })

                expect(featureFlags.getFlagsWithDetails()).toEqual({
                    'beta-feature': {
                        key: 'beta-feature',
                        enabled: true,
                        variant: 'beta-variant-1',
                        reason: {
                            code: 'test-reason',
                            condition_index: 1,
                            description: undefined,
                        },
                        metadata: {
                            version: 4,
                            payload: { data: 'overridden' },
                            original_payload: { payload: 'test' },
                            id: 1,
                            description: 'test-description',
                        },
                    },
                })
            })

            it('clears overrides when passed false', () => {
                // Set some overrides first
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'beta-feature': false,
                    },
                    payloads: {
                        'beta-feature': { overridden: 'payload' },
                    },
                })

                // Clear overrides
                featureFlags.overrideFeatureFlags(false)

                expect(featureFlags.getFlagVariants()).toEqual({
                    'beta-feature': true,
                    'alpha-feature-2': true,
                })
                expect(featureFlags.getFlagPayloads()).toEqual({
                    'beta-feature': { original: 'payload' },
                    'alpha-feature-2': 123,
                })
            })

            it('includes overridden payload in feature flag called event', () => {
                featureFlags.overrideFeatureFlags({
                    flags: { 'beta-feature': true },
                    payloads: { 'beta-feature': { overridden: 'payload' } },
                })
                featureFlags._hasLoadedFlags = true

                featureFlags.getFeatureFlag('beta-feature')

                expect(instance.capture).toHaveBeenCalledWith('$feature_flag_called', {
                    $feature_flag: 'beta-feature',
                    $feature_flag_response: true,
                    $feature_flag_payload: { overridden: 'payload' },
                    $feature_flag_bootstrapped_response: null,
                    $feature_flag_bootstrapped_payload: null,
                    $used_bootstrap_value: true,
                })
            })

            it('includes original values in feature flag called event when details are available', () => {
                instance.persistence.props = {
                    $feature_flag_details: {
                        'beta-feature': {
                            key: 'beta-feature',
                            enabled: false,
                            variant: undefined,
                            reason: undefined,
                            metadata: {
                                payload: { status: 'original' },
                            },
                        },
                        'alpha-feature-2': {
                            key: 'alpha-feature-2',
                            enabled: false,
                            variant: undefined,
                            reason: undefined,
                            metadata: undefined,
                        },
                        'multivariate-flag': {
                            key: 'multivariate-flag',
                            enabled: true,
                            variant: 'multivariate-variant-1',
                            reason: undefined,
                            metadata: undefined,
                        },
                    },
                }
                featureFlags.overrideFeatureFlags({
                    flags: { 'beta-feature': true, 'alpha-feature-2': 'variant-1', 'multivariate-flag': false },
                    payloads: { 'beta-feature': { overridden: { status: 'overridden' } } },
                })
                featureFlags._hasLoadedFlags = true

                featureFlags.getFeatureFlag('beta-feature')

                expect(instance.capture).toHaveBeenCalledWith('$feature_flag_called', {
                    $feature_flag: 'beta-feature',
                    $feature_flag_response: true,
                    $feature_flag_payload: { overridden: { status: 'overridden' } },
                    $feature_flag_bootstrapped_response: null,
                    $feature_flag_bootstrapped_payload: null,
                    $used_bootstrap_value: true,
                    $feature_flag_original_response: false,
                    $feature_flag_original_payload: { status: 'original' },
                    $feature_flag_request_id: undefined,
                })

                instance.capture.mockClear()

                featureFlags.getFeatureFlag('alpha-feature-2')

                expect(instance.capture).toHaveBeenCalledWith('$feature_flag_called', {
                    $feature_flag: 'alpha-feature-2',
                    $feature_flag_response: 'variant-1',
                    $feature_flag_payload: null,
                    $feature_flag_bootstrapped_response: null,
                    $feature_flag_bootstrapped_payload: null,
                    $used_bootstrap_value: true,
                    $feature_flag_original_response: false,
                    $feature_flag_request_id: undefined,
                })

                instance.capture.mockClear()

                featureFlags.getFeatureFlag('multivariate-flag')

                expect(instance.capture).toHaveBeenCalledWith('$feature_flag_called', {
                    $feature_flag: 'multivariate-flag',
                    $feature_flag_response: false,
                    $feature_flag_payload: null,
                    $feature_flag_bootstrapped_response: null,
                    $feature_flag_bootstrapped_payload: null,
                    $used_bootstrap_value: true,
                    $feature_flag_original_response: 'multivariate-variant-1',
                    $feature_flag_request_id: undefined,
                })
            })
        })

        describe('callback behavior', () => {
            let callbackSpy: jest.Mock

            beforeEach(() => {
                callbackSpy = jest.fn()
                featureFlags.onFeatureFlags(callbackSpy)
            })

            it('triggers callback with feature flag changes', () => {
                featureFlags.overrideFeatureFlags({
                    flags: {
                        'beta-feature': false,
                    },
                })
                expect(callbackSpy).toHaveBeenCalledWith(
                    ['alpha-feature-2'],
                    { 'alpha-feature-2': true },
                    expect.any(Object)
                )

                callbackSpy.mockClear()

                featureFlags.overrideFeatureFlags({
                    flags: {
                        'beta-feature': false,
                        'alpha-feature-2': 'variant-1',
                    },
                })

                expect(callbackSpy).toHaveBeenCalledWith(
                    ['alpha-feature-2'],
                    { 'alpha-feature-2': 'variant-1' },
                    expect.any(Object)
                )
            })
        })
    })

    describe('_callFlagsEndpoint via reloadFeatureFlags', () => {
        it('should not call /flags if advanced_disable_decide is true', () => {
            instance.config.advanced_disable_decide = true
            featureFlags.reloadFeatureFlags()
            jest.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(0)
        })

        it('should not call /flags if advanced_disable_flags is true', () => {
            instance.config.advanced_disable_flags = true
            featureFlags.reloadFeatureFlags()
            jest.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(0)
        })

        it('should call /flags via reloadFeatureFlags', () => {
            featureFlags.reloadFeatureFlags()
            jest.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(undefined)
        })

        it('should call /flags with flags disabled if advanced_disable_feature_flags is set', () => {
            instance.config.advanced_disable_feature_flags = true
            // Call _callFlagsEndpoint directly because reloadFeatureFlags() returns early
            // when advanced_disable_feature_flags is true
            featureFlags._callFlagsEndpoint({ disableFlags: true })
            jest.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(true)
        })

        it('should always include timezone in request data', () => {
            featureFlags.reloadFeatureFlags()
            jest.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.timezone).toBeDefined()
        })

        it('should call /flags with evaluation_contexts when configured', () => {
            instance.config.evaluation_contexts = ['production', 'web']
            featureFlags.reloadFeatureFlags()
            jest.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.evaluation_contexts).toEqual(['production', 'web'])
        })

        it('should not include evaluation_contexts when not configured', () => {
            featureFlags.reloadFeatureFlags()
            jest.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.evaluation_contexts).toBe(undefined)
        })

        it('should not include evaluation_contexts when configured as empty array', () => {
            instance.config.evaluation_contexts = []
            featureFlags.reloadFeatureFlags()
            jest.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.evaluation_contexts).toBe(undefined)
        })

        it('should support deprecated evaluation_environments field', () => {
            instance.config.evaluation_environments = ['production', 'web']
            featureFlags.reloadFeatureFlags()
            jest.runOnlyPendingTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.evaluation_contexts).toEqual(['production', 'web'])
        })
    })

    describe('onFeatureFlags', () => {
        beforeEach(() => {
            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {
                        featureFlags: {
                            first: 'variant-1',
                            second: true,
                            third: false,
                        },
                    },
                })
            )
        })

        it('onFeatureFlags should not be called immediately if feature flags not loaded', () => {
            let called = false
            let _flags = []
            let _variants = {}
            let _error = undefined

            featureFlags.onFeatureFlags((flags, variants, errors) => {
                called = true
                _flags = flags
                _variants = variants
                _error = errors?.errorsLoading
            })
            expect(called).toEqual(false)

            featureFlags.setAnonymousDistinctId('rando_id')
            featureFlags.reloadFeatureFlags()

            jest.runAllTimers()
            expect(called).toEqual(true)
            expect(_error).toEqual(false)
            expect(_flags).toEqual(['first', 'second'])
            expect(_variants).toEqual({
                first: 'variant-1',
                second: true,
            })
        })

        it('onFeatureFlags callback should be called immediately if feature flags were loaded', () => {
            featureFlags._hasLoadedFlags = true
            let called = false
            featureFlags.onFeatureFlags(() => (called = true))
            expect(called).toEqual(true)

            called = false
        })

        it('onFeatureFlags should not return flags that are off', () => {
            featureFlags._hasLoadedFlags = true
            let _flags = []
            let _variants = {}
            featureFlags.onFeatureFlags((flags, variants) => {
                _flags = flags
                _variants = variants
            })

            expect(_flags).toEqual(['beta-feature', 'alpha-feature-2', 'multivariate-flag'])
            expect(_variants).toEqual({
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            })
        })

        it('onFeatureFlags should return function to unsubscribe the function from onFeatureFlags', () => {
            let called = false

            const unsubscribe = featureFlags.onFeatureFlags(() => {
                called = true
            })

            featureFlags.setAnonymousDistinctId('rando_id')
            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(called).toEqual(true)

            called = false

            unsubscribe()

            featureFlags.setAnonymousDistinctId('rando_id')
            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(called).toEqual(false)
        })
    })

    describe('featureFlagsReloading event', () => {
        beforeEach(() => {
            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
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
            const loadingCallback = jest.fn()
            instance.on('featureFlagsReloading', loadingCallback)

            featureFlags.reloadFeatureFlags()

            expect(loadingCallback).toHaveBeenCalledTimes(1)
            expect(loadingCallback).toHaveBeenCalledWith(true)
        })

        it('should not emit featureFlagsReloading event if already debouncing', () => {
            const loadingCallback = jest.fn()
            instance.on('featureFlagsReloading', loadingCallback)

            featureFlags.reloadFeatureFlags()
            featureFlags.reloadFeatureFlags()
            featureFlags.reloadFeatureFlags()

            // Should only emit once because subsequent calls are debounced
            expect(loadingCallback).toHaveBeenCalledTimes(1)
        })

        it('should emit featureFlagsReloading before onFeatureFlags callback', () => {
            const callOrder: string[] = []

            instance.on('featureFlagsReloading', () => {
                callOrder.push('loading')
            })

            featureFlags.onFeatureFlags(() => {
                callOrder.push('loaded')
            })

            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(callOrder).toEqual(['loading', 'loaded'])
        })

        it('should not emit featureFlagsReloading if reloading is disabled', () => {
            const loadingCallback = jest.fn()
            instance.on('featureFlagsReloading', loadingCallback)

            featureFlags.setReloadingPaused(true)
            featureFlags.reloadFeatureFlags()

            expect(loadingCallback).not.toHaveBeenCalled()
        })

        it('should not emit featureFlagsReloading if feature flags are disabled', () => {
            const loadingCallback = jest.fn()
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

        const EARLY_ACCESS_FEATURE_SECOND = {
            name: 'second',
            description: 'second description',
            stage: 'alpha',
            imageUrl: null,
            documentationUrl: 'http://example.com',
            flagKey: 'second-flag',
        }

        beforeEach(() => {
            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {
                        earlyAccessFeatures: [EARLY_ACCESS_FEATURE_FIRST],
                    },
                })
            )
        })

        it('getEarlyAccessFeatures requests early access features if not present', () => {
            featureFlags.getEarlyAccessFeatures((data) => {
                expect(data).toEqual([EARLY_ACCESS_FEATURE_FIRST])
            })

            expect(instance._send_request).toHaveBeenCalledWith({
                url: 'https://us.i.posthog.com/api/early_access_features/?token=random fake token',
                method: 'GET',
                callback: expect.any(Function),
            })
            expect(instance._send_request).toHaveBeenCalledTimes(1)

            expect(instance.persistence.props.$early_access_features).toEqual([EARLY_ACCESS_FEATURE_FIRST])

            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {
                        earlyAccessFeatures: [EARLY_ACCESS_FEATURE_SECOND],
                    },
                })
            )

            // request again, shouldn't call _send_request again
            featureFlags.getEarlyAccessFeatures((data) => {
                expect(data).toEqual([EARLY_ACCESS_FEATURE_FIRST])
            })
            expect(instance._send_request).toHaveBeenCalledTimes(0)
        })

        it('getEarlyAccessFeatures force reloads early access features when asked to', () => {
            featureFlags.getEarlyAccessFeatures((data) => {
                expect(data).toEqual([EARLY_ACCESS_FEATURE_FIRST])
            })

            expect(instance._send_request).toHaveBeenCalledWith({
                url: 'https://us.i.posthog.com/api/early_access_features/?token=random fake token',
                method: 'GET',
                callback: expect.any(Function),
            })
            expect(instance._send_request).toHaveBeenCalledTimes(1)

            expect(instance.persistence.props.$early_access_features).toEqual([EARLY_ACCESS_FEATURE_FIRST])

            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {
                        earlyAccessFeatures: [EARLY_ACCESS_FEATURE_SECOND],
                    },
                })
            )

            // request again, should call _send_request because we're forcing a reload
            featureFlags.getEarlyAccessFeatures((data) => {
                expect(data).toEqual([EARLY_ACCESS_FEATURE_SECOND])
            }, true)
            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('getEarlyAccessFeatures can request specific stages', () => {
            featureFlags.getEarlyAccessFeatures(
                (data) => {
                    expect(data).toEqual([EARLY_ACCESS_FEATURE_FIRST])
                },
                false,
                ['concept', 'beta']
            )

            expect(instance._send_request).toHaveBeenCalledWith({
                url: 'https://us.i.posthog.com/api/early_access_features/?token=random fake token&stage=concept&stage=beta',
                method: 'GET',
                callback: expect.any(Function),
            })
        })

        it('getEarlyAccessFeatures replaces existing features completely instead of merging', () => {
            // Set up initial features in persistence
            instance.persistence.props.$early_access_features = [
                EARLY_ACCESS_FEATURE_FIRST,
                { ...EARLY_ACCESS_FEATURE_SECOND, flagKey: 'old-feature' },
            ]

            // Mock unregister to track calls
            const unregisterSpy = jest.spyOn(instance.persistence, 'unregister')
            const registerSpy = jest.spyOn(instance.persistence, 'register')

            // Force reload to trigger API call
            featureFlags.getEarlyAccessFeatures((data) => {
                expect(data).toEqual([EARLY_ACCESS_FEATURE_FIRST])
            }, true)

            // Verify unregister was called first to clear old data
            expect(unregisterSpy).toHaveBeenCalledWith('$early_access_features')

            // Verify both methods were called
            expect(unregisterSpy).toHaveBeenCalled()
            expect(registerSpy).toHaveBeenCalled()

            // Verify the order by checking call order
            const unregisterCallOrder = unregisterSpy.mock.invocationCallOrder[0]
            const registerCallOrder = registerSpy.mock.invocationCallOrder[0]
            expect(unregisterCallOrder).toBeLessThan(registerCallOrder)

            // Verify register was called with new data
            expect(registerSpy).toHaveBeenCalledWith({
                $early_access_features: [EARLY_ACCESS_FEATURE_FIRST],
            })

            // Verify persistence only contains new features, not old ones
            expect(instance.persistence.props.$early_access_features).toEqual([EARLY_ACCESS_FEATURE_FIRST])
            expect(instance.persistence.props.$early_access_features).not.toContainEqual(
                expect.objectContaining({ flagKey: 'old-feature' })
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
                register: jest.fn(),
                unregister: jest.fn(),
                clear: jest.fn(),
            }
        })

        it('update enrollment should update the early access feature enrollment', () => {
            featureFlags.updateEarlyAccessFeatureEnrollment('first-flag', true)

            expect(instance.capture).toHaveBeenCalledTimes(1)
            expect(instance.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: true,
                $feature_flag: 'first-flag',
                $set: {
                    '$feature_enrollment/first-flag': true,
                },
            })

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
                // early access feature flag is added to list of flags
                'first-flag': true,
            })

            // now enrollment is turned off
            featureFlags.updateEarlyAccessFeatureEnrollment('first-flag', false)

            expect(instance.capture).toHaveBeenCalledTimes(2)
            expect(instance.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: false,
                $feature_flag: 'first-flag',
                $set: {
                    '$feature_enrollment/first-flag': false,
                },
            })

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
                // early access feature flag is added to list of flags
                'first-flag': false,
            })
        })

        it('update enrollment with stage should include stage in event', () => {
            featureFlags.updateEarlyAccessFeatureEnrollment('stage-flag', true, 'beta')

            expect(instance.capture).toHaveBeenCalledTimes(1)
            expect(instance.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: true,
                $feature_flag: 'stage-flag',
                $feature_enrollment_stage: 'beta',
                $set: {
                    '$feature_enrollment/stage-flag': true,
                },
            })

            // Test with different stage
            featureFlags.updateEarlyAccessFeatureEnrollment('concept-flag', false, 'concept')

            expect(instance.capture).toHaveBeenCalledTimes(2)
            expect(instance.capture).toHaveBeenLastCalledWith('$feature_enrollment_update', {
                $feature_enrollment: false,
                $feature_flag: 'concept-flag',
                $feature_enrollment_stage: 'concept',
                $set: {
                    '$feature_enrollment/concept-flag': false,
                },
            })

            // Test without stage (backward compatibility)
            featureFlags.updateEarlyAccessFeatureEnrollment('no-stage-flag', true)

            expect(instance.capture).toHaveBeenCalledTimes(3)
            expect(instance.capture).toHaveBeenLastCalledWith('$feature_enrollment_update', {
                $feature_enrollment: true,
                $feature_flag: 'no-stage-flag',
                $set: {
                    '$feature_enrollment/no-stage-flag': true,
                },
            })
            // Should not have stage property when not provided
            expect(instance.capture.mock.calls[2][1]).not.toHaveProperty('$feature_enrollment_stage')
        })

        it('reloading flags after update enrollment should send properties', () => {
            featureFlags.updateEarlyAccessFeatureEnrollment('x-flag', true)

            expect(instance.capture).toHaveBeenCalledTimes(1)
            expect(instance.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: true,
                $feature_flag: 'x-flag',
                $set: {
                    '$feature_enrollment/x-flag': true,
                },
            })

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
                // early access feature flag is added to list of flags
                'x-flag': true,
            })

            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()
            // check the request sent person properties
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: undefined,
                group_properties: undefined,
                person_properties: {
                    '$feature_enrollment/x-flag': true,
                },
                timezone: expect.any(String),
            })
        })
    })

    describe('device_id in flags requests', () => {
        beforeEach(() => {
            // Clear persistence before each test in this suite
            instance.persistence.unregister('$device_id')
            instance.persistence.unregister('$stored_person_properties')
            instance.persistence.unregister('$stored_group_properties')

            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
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

        it('should include device_id in flags request when available', () => {
            instance.persistence.register({
                $device_id: 'test-device-uuid-123',
            })

            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                $device_id: 'test-device-uuid-123',
                groups: undefined,
                group_properties: undefined,
                person_properties: {},
                timezone: expect.any(String),
            })
        })

        it('should omit device_id when it is null (cookieless mode)', () => {
            instance.persistence.register({
                $device_id: null,
            })

            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: undefined,
                group_properties: undefined,
                person_properties: {},
                timezone: expect.any(String),
            })
            expect(instance._send_request.mock.calls[0][0].data).not.toHaveProperty('$device_id')
        })

        it('should omit device_id when it is undefined', () => {
            // Don't register device_id at all
            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: undefined,
                group_properties: undefined,
                person_properties: {},
                timezone: expect.any(String),
            })
            expect(instance._send_request.mock.calls[0][0].data).not.toHaveProperty('$device_id')
        })

        it('should include device_id along with $anon_distinct_id on identify', () => {
            instance.persistence.register({
                $device_id: 'device-uuid-456',
            })

            featureFlags.setAnonymousDistinctId('anon_id_789')
            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $device_id: 'device-uuid-456',
                $anon_distinct_id: 'anon_id_789',
                groups: undefined,
                group_properties: undefined,
                person_properties: {},
                timezone: expect.any(String),
            })
        })

        it('should include device_id with person_properties', () => {
            instance.persistence.register({
                $device_id: 'device-uuid-999',
            })

            featureFlags.setPersonPropertiesForFlags({ plan: 'pro', beta_tester: true })
            jest.runAllTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                $device_id: 'device-uuid-999',
                groups: undefined,
                group_properties: undefined,
                person_properties: { plan: 'pro', beta_tester: true },
                timezone: expect.any(String),
            })
        })

        it('should include device_id with group_properties', () => {
            instance.persistence.register({
                $device_id: 'device-uuid-888',
            })

            featureFlags.setGroupPropertiesForFlags({ company: { name: 'Acme', seats: 50 } })
            jest.runAllTimers()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                $device_id: 'device-uuid-888',
                groups: undefined,
                person_properties: {},
                group_properties: { company: { name: 'Acme', seats: 50 } },
                timezone: expect.any(String),
            })
        })
    })

    describe('reloadFeatureFlags', () => {
        beforeEach(() => {
            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
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

        it('on providing anonDistinctId', () => {
            featureFlags.setAnonymousDistinctId('rando_id')
            featureFlags.reloadFeatureFlags()

            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent $anon_distinct_id
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: 'rando_id',
                groups: undefined,
                group_properties: undefined,
                person_properties: {},
                timezone: expect.any(String),
            })
        })

        it('on providing anonDistinctId and calling reload multiple times', () => {
            featureFlags.setAnonymousDistinctId('rando_id')
            featureFlags.reloadFeatureFlags()
            featureFlags.reloadFeatureFlags()

            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent $anon_distinct_id
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: 'rando_id',
                groups: undefined,
                group_properties: undefined,
                person_properties: {},
                timezone: expect.any(String),
            })

            featureFlags.reloadFeatureFlags()
            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            // check the request didn't send $anon_distinct_id the second time around
            expect(instance._send_request.mock.calls[1][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: undefined,
                group_properties: undefined,
                person_properties: {},
                timezone: expect.any(String),
            })

            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            // check the request didn't send $anon_distinct_id the second time around
            expect(instance._send_request.mock.calls[2][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: undefined,
                group_properties: undefined,
                person_properties: {},
                timezone: expect.any(String),
            })
        })

        it('on providing personProperties runs reload automatically', () => {
            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' })

            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check right compression is sent
            expect(instance._send_request.mock.calls[0][0].compression).toEqual('base64')

            // check the request sent person properties
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: undefined,
                group_properties: undefined,
                person_properties: { a: 'b', c: 'd' },
                timezone: expect.any(String),
            })
        })

        it('on providing config advanced_disable_feature_flags', () => {
            instance.config = {
                ...instance.config,
                advanced_disable_feature_flags: true,
            }
            instance.persistence.register({
                $enabled_feature_flags: {
                    'beta-feature': true,
                    'random-feature': 'xatu',
                },
            })

            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                'beta-feature': true,
                'random-feature': 'xatu',
            })

            // check reload request was not sent
            expect(instance._send_request).not.toHaveBeenCalled()

            // check the same for other ways to call reload flags

            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' })

            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                'beta-feature': true,
                'random-feature': 'xatu',
            })

            // check reload request was not sent
            expect(instance._send_request).not.toHaveBeenCalled()
        })

        it('on providing config disable_compression', () => {
            instance.config = {
                ...instance.config,
                disable_compression: true,
            }

            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(instance._send_request.mock.calls[0][0].compression).toEqual(undefined)
        })
    })

    describe('override person and group properties', () => {
        beforeEach(() => {
            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
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

        it('on providing personProperties updates properties successively', () => {
            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' })
            featureFlags.setPersonPropertiesForFlags({ x: 'y', c: 'e' })

            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent person properties
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: undefined,
                group_properties: undefined,
                person_properties: { a: 'b', c: 'e', x: 'y' },
                timezone: expect.any(String),
            })
        })

        it('doesnt reload flags if explicitly asked not to', () => {
            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' }, false)

            jest.runAllTimers()

            // still old flags
            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
            })

            expect(instance._send_request).not.toHaveBeenCalled()
        })

        it('resetPersonProperties resets all properties', () => {
            featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' }, false)
            featureFlags.setPersonPropertiesForFlags({ x: 'y', c: 'e' }, false)
            jest.runAllTimers()

            expect(instance.persistence.props.$stored_person_properties).toEqual({ a: 'b', c: 'e', x: 'y' })

            featureFlags.resetPersonPropertiesForFlags()
            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            // check the request did not send person properties
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: undefined,
                group_properties: undefined,
                person_properties: {},
                timezone: expect.any(String),
            })
        })

        it('on providing groupProperties updates properties successively', () => {
            featureFlags.setGroupPropertiesForFlags({ orgs: { a: 'b', c: 'd' }, projects: { x: 'y', c: 'e' } })

            expect(instance.persistence.props.$stored_group_properties).toEqual({
                orgs: { a: 'b', c: 'd' },
                projects: { x: 'y', c: 'e' },
            })

            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent person properties
            expect(instance._send_request.mock.calls[0][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: undefined,
                groups: undefined,
                person_properties: {},
                group_properties: { orgs: { a: 'b', c: 'd' }, projects: { x: 'y', c: 'e' } },
                timezone: expect.any(String),
            })
        })

        it('handles groupProperties updates', () => {
            featureFlags.setGroupPropertiesForFlags({ orgs: { a: 'b', c: 'd' }, projects: { x: 'y', c: 'e' } })

            expect(instance.persistence.props.$stored_group_properties).toEqual({
                orgs: { a: 'b', c: 'd' },
                projects: { x: 'y', c: 'e' },
            })

            featureFlags.setGroupPropertiesForFlags({ orgs: { w: '1' }, other: { z: '2' } })

            expect(instance.persistence.props.$stored_group_properties).toEqual({
                orgs: { a: 'b', c: 'd', w: '1' },
                projects: { x: 'y', c: 'e' },
                other: { z: '2' },
            })

            featureFlags.resetGroupPropertiesForFlags('orgs')

            expect(instance.persistence.props.$stored_group_properties).toEqual({
                orgs: {},
                projects: { x: 'y', c: 'e' },
                other: { z: '2' },
            })

            featureFlags.resetGroupPropertiesForFlags()

            expect(instance.persistence.props.$stored_group_properties).toEqual(undefined)

            jest.runAllTimers()
        })

        it('doesnt reload group flags if explicitly asked not to', () => {
            featureFlags.setGroupPropertiesForFlags({ orgs: { a: 'b', c: 'd' } }, false)

            jest.runAllTimers()

            // still old flags
            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
            })

            expect(instance._send_request).not.toHaveBeenCalled()
        })
    })

    describe('when subsequent /flags?v=1 calls return partial results', () => {
        beforeEach(() => {
            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {
                        featureFlags: { 'x-flag': 'x-value', 'feature-1': false },
                        errorsWhileComputingFlags: true,
                    },
                })
            )
        })

        it('should return combined results', () => {
            featureFlags.reloadFeatureFlags()

            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'multivariate-flag': 'variant-1',
                'x-flag': 'x-value',
                'feature-1': false,
                'disabled-flag': false,
            })
        })
    })

    describe('when subsequent /flags?v=2 calls return partial results', () => {
        beforeEach(() => {
            // Need to register v2 flags to test v2 behavior.
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
                $feature_flag_details: {
                    'beta-feature': {
                        key: 'beta-feature',
                        enabled: true,
                        variant: undefined,
                        metadata: { payload: { some: 'payload' } },
                    },
                    'alpha-feature-2': {
                        key: 'alpha-feature-2',
                        enabled: true,
                        variant: undefined,
                        metadata: { payload: 200 },
                    },
                    'multivariate-flag': {
                        key: 'multivariate-flag',
                        enabled: true,
                        variant: 'variant-1',
                        metadata: { payload: undefined },
                    },
                    'disabled-flag': {
                        key: 'disabled-flag',
                        enabled: false,
                        variant: undefined,
                        metadata: undefined,
                    },
                },
                $override_feature_flags: false,
            })
            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {
                        flags: {
                            'x-flag': { key: 'x-flag', enabled: true, variant: 'x-value', metadata: undefined },
                            'feature-1': { key: 'feature-1', enabled: false, variant: undefined, metadata: undefined },
                        },
                        errorsWhileComputingFlags: true,
                    },
                })
            )
        })

        it('should return combined results', () => {
            featureFlags.reloadFeatureFlags()

            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'feature-1': false,
                'multivariate-flag': 'variant-1',
                'x-flag': 'x-value',
            })
        })
    })

    describe('when subsequent /flags?v=2 calls return failed flags with errorsWhileComputingFlags', () => {
        beforeEach(() => {
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
                $feature_flag_details: {
                    'beta-feature': {
                        key: 'beta-feature',
                        enabled: true,
                        variant: undefined,
                        metadata: { payload: { some: 'payload' } },
                    },
                    'alpha-feature-2': {
                        key: 'alpha-feature-2',
                        enabled: true,
                        variant: undefined,
                        metadata: { payload: 200 },
                    },
                    'multivariate-flag': {
                        key: 'multivariate-flag',
                        enabled: true,
                        variant: 'variant-1',
                        metadata: { payload: undefined },
                    },
                    'disabled-flag': {
                        key: 'disabled-flag',
                        enabled: false,
                        variant: undefined,
                        metadata: undefined,
                    },
                },
                $override_feature_flags: false,
            })
            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {
                        flags: {
                            'x-flag': {
                                key: 'x-flag',
                                enabled: true,
                                variant: 'x-value',
                                failed: false,
                                reason: { code: 'condition_match', description: 'Matched condition set 1' },
                                metadata: { id: 10, version: 1 },
                            },
                            'beta-feature': {
                                key: 'beta-feature',
                                enabled: false,
                                variant: undefined,
                                failed: true,
                                reason: { code: 'database_error', description: 'Database connection error' },
                                metadata: { id: 2, version: 1 },
                            },
                        },
                        errorsWhileComputingFlags: true,
                    },
                })
            )
        })

        it('should filter out failed flags and preserve their cached values', () => {
            featureFlags.reloadFeatureFlags()

            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true, // preserved from cache, not overwritten by failed evaluation
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
                'x-flag': 'x-value', // new successful flag merged in
            })
        })
    })

    describe('when subsequent /flags?v=1 calls return results without errors', () => {
        beforeEach(() => {
            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {
                        featureFlags: { 'x-flag': 'x-value', 'feature-1': false },
                        errorsWhileComputingFlags: false,
                    },
                })
            )
        })

        it('should return combined results', () => {
            featureFlags.reloadFeatureFlags()

            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                'x-flag': 'x-value',
                'feature-1': false,
            })
        })
    })

    describe('when /flags times out or errors out', () => {
        beforeEach(() => {
            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 500,
                    text: 'Internal Server Error',
                })
            )
        })

        it('should not change the existing flags', () => {
            instance.persistence.register({
                $enabled_feature_flags: {
                    'beta-feature': true,
                    'random-feature': 'xatu',
                },
            })

            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(featureFlags.getFlagVariants()).toEqual({
                'beta-feature': true,
                'random-feature': 'xatu',
            })
        })

        it('should call onFeatureFlags even when /flags errors out', () => {
            let called = false
            let _flags = []
            let _variants = {}
            let _errors = undefined

            instance.persistence.register({
                $enabled_feature_flags: {},
            })

            featureFlags.onFeatureFlags((flags, variants, errors) => {
                called = true
                _flags = flags
                _variants = variants
                _errors = errors?.errorsLoading
            })
            expect(called).toEqual(false)

            featureFlags.reloadFeatureFlags()

            jest.runAllTimers()
            expect(called).toEqual(true)
            expect(_errors).toEqual(true)
            expect(_flags).toEqual([])
            expect(_variants).toEqual({})
        })

        it('should call onFeatureFlags with existing flags', () => {
            let called = false
            let _flags = []
            let _variants = {}
            let _errors = undefined

            featureFlags.onFeatureFlags((flags, variants, errors) => {
                called = true
                _flags = flags
                _variants = variants
                _errors = errors?.errorsLoading
            })
            expect(called).toEqual(false)

            featureFlags.reloadFeatureFlags()

            jest.runAllTimers()
            expect(called).toEqual(true)
            expect(_errors).toEqual(true)
            expect(_flags).toEqual(['beta-feature', 'alpha-feature-2', 'multivariate-flag'])
            expect(_variants).toEqual({
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            })
        })

        it('should call onFeatureFlags with existing flags on timeouts', () => {
            instance._send_request = jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 0,
                    text: '',
                })
            )

            let called = false
            let _flags = []
            let _variants = {}
            let _errors = undefined

            featureFlags.onFeatureFlags((flags, variants, errors) => {
                called = true
                _flags = flags
                _variants = variants
                _errors = errors?.errorsLoading
            })
            expect(called).toEqual(false)

            featureFlags.reloadFeatureFlags()

            jest.runAllTimers()
            expect(called).toEqual(true)
            expect(_errors).toEqual(true)
            expect(_flags).toEqual(['beta-feature', 'alpha-feature-2', 'multivariate-flag'])
            expect(_variants).toEqual({
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            })
        })
    })

    describe('Feature Flag Request ID and Evaluated At', () => {
        const TEST_REQUEST_ID = 'test-request-id-123'
        const TEST_EVALUATED_AT = 1234567890

        it('saves requestId from /flags response', () => {
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                requestId: TEST_REQUEST_ID,
            })

            expect(instance.get_property('$feature_flag_request_id')).toEqual(TEST_REQUEST_ID)
        })

        it('saves evaluatedAt from /flags response', () => {
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                evaluatedAt: TEST_EVALUATED_AT,
            })

            expect(instance.get_property('$feature_flag_evaluated_at')).toEqual(TEST_EVALUATED_AT)
        })

        it('includes requestId in feature flag called event', () => {
            // Setup flags with requestId
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                requestId: TEST_REQUEST_ID,
            })
            featureFlags._hasLoadedFlags = true

            // Test flag call
            featureFlags.getFeatureFlag('test-flag')

            // Verify capture call includes requestId
            expect(instance.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag: 'test-flag',
                    $feature_flag_response: true,
                    $feature_flag_request_id: TEST_REQUEST_ID,
                })
            )
        })

        it('includes evaluatedAt in feature flag called event', () => {
            // Setup flags with evaluatedAt
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                evaluatedAt: TEST_EVALUATED_AT,
            })
            featureFlags._hasLoadedFlags = true

            // Test flag call
            featureFlags.getFeatureFlag('test-flag')

            // Verify capture call includes evaluatedAt
            expect(instance.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag: 'test-flag',
                    $feature_flag_response: true,
                    $feature_flag_evaluated_at: TEST_EVALUATED_AT,
                })
            )
        })

        it('includes version in feature flag called event', () => {
            // Setup flags with requestId and evaluatedAt
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                requestId: TEST_REQUEST_ID,
                evaluatedAt: TEST_EVALUATED_AT,
                flags: {
                    'test-flag': {
                        key: 'test-flag',
                        id: 23,
                        enabled: true,
                        variant: 'variant-1',
                        reason: {
                            description: 'Matched condition set 1',
                            code: 'test-code',
                            condition_index: 1,
                        },
                        metadata: {
                            id: 23,
                            version: 42,
                        },
                    },
                },
            })
            featureFlags._hasLoadedFlags = true

            // Test flag call
            featureFlags.getFeatureFlag('test-flag')

            // Verify capture call includes requestId and evaluatedAt
            expect(instance.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag: 'test-flag',
                    $feature_flag_response: 'variant-1',
                    $feature_flag_request_id: TEST_REQUEST_ID,
                    $feature_flag_evaluated_at: TEST_EVALUATED_AT,
                    $feature_flag_version: 42,
                    $feature_flag_reason: 'Matched condition set 1',
                    $feature_flag_id: 23,
                })
            )
        })

        it('updates requestId when new /flags response is received', () => {
            // First /flags response
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                requestId: TEST_REQUEST_ID,
            })

            expect(instance.get_property('$feature_flag_request_id')).toEqual(TEST_REQUEST_ID)

            // Second /flags response with new ID
            const NEW_REQUEST_ID = 'new-request-id-456'
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                requestId: NEW_REQUEST_ID,
            })

            expect(instance.get_property('$feature_flag_request_id')).toEqual(NEW_REQUEST_ID)

            // Verify new ID is used in events
            featureFlags._hasLoadedFlags = true
            featureFlags.getFeatureFlag('test-flag')

            expect(instance.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag_request_id: NEW_REQUEST_ID,
                })
            )
        })

        it('updates evaluatedAt when new /flags response is received', () => {
            // First /flags response
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                evaluatedAt: TEST_EVALUATED_AT,
            })

            expect(instance.get_property('$feature_flag_evaluated_at')).toEqual(TEST_EVALUATED_AT)

            // Second /flags response with new timestamp
            const NEW_EVALUATED_AT = 9876543210
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                evaluatedAt: NEW_EVALUATED_AT,
            })

            expect(instance.get_property('$feature_flag_evaluated_at')).toEqual(NEW_EVALUATED_AT)

            // Verify new timestamp is used in events
            featureFlags._hasLoadedFlags = true
            featureFlags.getFeatureFlag('test-flag')

            expect(instance.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag_evaluated_at: NEW_EVALUATED_AT,
                })
            )
        })
    })
})

describe('parseFlagsResponse', () => {
    let persistence

    beforeEach(() => {
        persistence = { register: jest.fn(), unregister: jest.fn() }
    })

    it('enables multivariate feature flags from /flags?v=2 response', () => {
        const flagsResponse = {
            featureFlags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            },
            featureFlagPayloads: {
                'beta-feature': 300,
                'alpha-feature-2': 'fake-payload',
            },
        }
        jest.spyOn(window.console, 'warn').mockImplementation()

        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenCalledWith({
            $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
            $enabled_feature_flags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            },
            $feature_flag_payloads: {
                'beta-feature': 300,
                'alpha-feature-2': 'fake-payload',
            },
            $feature_flag_details: {},
        })
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version'
        )
    })

    it('enables feature flag details from /flags?v=1 response', () => {
        const flagsResponse = {
            featureFlags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            },
            featureFlagPayloads: {
                'beta-feature': 300,
                'alpha-feature-2': '"fake-payload"',
            },
        }
        jest.spyOn(window.console, 'warn').mockImplementation()

        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenCalledWith({
            $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
            $enabled_feature_flags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            },
            $feature_flag_payloads: {
                'beta-feature': 300,
                'alpha-feature-2': '"fake-payload"',
            },
            $feature_flag_details: {},
        })
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version'
        )
    })

    it('enables feature flag details from /flags?v=2 response', () => {
        const flagsResponse = {
            flags: {
                'beta-feature': {
                    key: 'beta-feature',
                    enabled: true,
                    variant: 'beta-variant-1',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 2,
                        payload: 300,
                        id: 1,
                        description: 'test-description',
                    },
                },
                'alpha-feature': {
                    key: 'alpha-feature',
                    enabled: true,
                    variant: undefined,
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 21,
                        payload: undefined,
                        id: 2,
                        description: 'test-description',
                    },
                },
                'multivariate-flag': {
                    key: 'multivariate-flag',
                    enabled: true,
                    variant: 'multi-variant-2',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 32,
                        payload: '"fake-payload"',
                        id: 3,
                        description: 'test-description',
                    },
                },
                'disabled-feature': {
                    key: 'disabled-feature',
                    enabled: false,
                    variant: undefined,
                    reason: {
                        code: 'no_matching_condition',
                        condition_index: undefined,
                        description: undefined,
                    },
                    metadata: {
                        version: 9,
                        payload: undefined,
                        id: 4,
                        description: 'not ready yet',
                    },
                },
            },
        }
        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenCalledWith({
            $active_feature_flags: ['beta-feature', 'alpha-feature', 'multivariate-flag'],
            $enabled_feature_flags: {
                'alpha-feature': true,
                'beta-feature': 'beta-variant-1',
                'disabled-feature': false,
                'multivariate-flag': 'multi-variant-2',
            },
            $feature_flag_payloads: {
                'beta-feature': 300,
                'multivariate-flag': '"fake-payload"',
            },
            $feature_flag_details: {
                'beta-feature': {
                    key: 'beta-feature',
                    enabled: true,
                    variant: 'beta-variant-1',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 2,
                        payload: 300,
                        id: 1,
                        description: 'test-description',
                    },
                },
                'alpha-feature': {
                    key: 'alpha-feature',
                    enabled: true,
                    variant: undefined,
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 21,
                        payload: undefined,
                        id: 2,
                        description: 'test-description',
                    },
                },
                'multivariate-flag': {
                    key: 'multivariate-flag',
                    enabled: true,
                    variant: 'multi-variant-2',
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 32,
                        payload: '"fake-payload"',
                        id: 3,
                        description: 'test-description',
                    },
                },
                'disabled-feature': {
                    key: 'disabled-feature',
                    enabled: false,
                    variant: undefined,
                    reason: {
                        code: 'no_matching_condition',
                        condition_index: undefined,
                        description: undefined,
                    },
                    metadata: {
                        version: 9,
                        payload: undefined,
                        id: 4,
                        description: 'not ready yet',
                    },
                },
            },
        })
    })

    it('enables feature flags from /flags response (v1 backwards compatibility)', () => {
        // checks that nothing fails when asking for ?v=2 and getting a ?v=1 response
        const flagsResponse = { featureFlags: ['beta-feature', 'alpha-feature-2'] }
        jest.spyOn(window.console, 'warn').mockImplementation()

        // @ts-expect-error testing backwards compatibility
        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenLastCalledWith({
            $active_feature_flags: ['beta-feature', 'alpha-feature-2'],
            $enabled_feature_flags: { 'beta-feature': true, 'alpha-feature-2': true },
        })
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'v1 of the feature flags endpoint is deprecated. Please use the latest version.'
        )
    })

    it('doesnt remove existing feature flags when no flags are returned', () => {
        jest.spyOn(window.console, 'warn').mockImplementation()
        parseFlagsResponse({}, persistence)

        expect(persistence.register).not.toHaveBeenCalled()
        expect(persistence.unregister).not.toHaveBeenCalled()
    })

    it('parses the requestId from the /flags?v=1 response', () => {
        const flagsResponse = {
            featureFlags: { 'test-flag': true },
            requestId: 'test-request-id-123',
        }
        jest.spyOn(window.console, 'warn').mockImplementation()

        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenCalledWith({
            $active_feature_flags: ['test-flag'],
            $enabled_feature_flags: { 'test-flag': true },
            $feature_flag_details: {},
            $feature_flag_payloads: {},
            $feature_flag_request_id: 'test-request-id-123',
        })
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version'
        )
    })

    it('parses the requestId from the /flags?v=2 response', () => {
        const flagsResponse = {
            flags: {
                'test-flag': {
                    key: 'test-flag',
                    enabled: true,
                    variant: undefined,
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 4,
                        payload: undefined,
                        id: 1,
                        description: 'test-description',
                    },
                },
            },
            requestId: 'test-request-id-123',
        }

        parseFlagsResponse(flagsResponse, persistence)

        expect(persistence.register).toHaveBeenCalledWith({
            $active_feature_flags: ['test-flag'],
            $enabled_feature_flags: { 'test-flag': true },
            $feature_flag_details: {
                'test-flag': {
                    key: 'test-flag',
                    enabled: true,
                    variant: undefined,
                    reason: {
                        code: 'test-reason',
                        condition_index: 1,
                        description: undefined,
                    },
                    metadata: {
                        version: 4,
                        payload: undefined,
                        id: 1,
                        description: 'test-description',
                    },
                },
            },
            $feature_flag_payloads: {},
            $feature_flag_request_id: 'test-request-id-123',
        })
    })
})

describe('filterActiveFeatureFlags', () => {
    it('should return empty if no flags are passed', () => {
        expect(filterActiveFeatureFlags({})).toEqual({})
    })

    it('should return empty if nothing is passed', () => {
        expect(filterActiveFeatureFlags()).toEqual({})
    })

    it('should filter flags', () => {
        expect(
            filterActiveFeatureFlags({
                'flag-1': true,
                'flag-2': false,
                'flag-3': 'variant-1',
            })
        ).toEqual({
            'flag-1': true,
            'flag-3': 'variant-1',
        })
    })
})

describe('getRemoteConfigPayload', () => {
    let instance: PostHog
    let featureFlags: PostHogFeatureFlags

    beforeEach(() => {
        instance = createMockPostHog({
            config: {
                token: 'test-token',
                api_host: 'https://test.com',
            } as PostHogConfig,
            get_distinct_id: () => 'test-distinct-id',
            _send_request: jest.fn(),
            requestRouter: {
                endpointFor: jest.fn().mockImplementation((endpoint, path) => `${endpoint}${path}`),
            },
        })

        featureFlags = new PostHogFeatureFlags(instance)
    })

    it('should include evaluation_contexts when configured', () => {
        instance.config.evaluation_contexts = ['staging', 'backend']

        const callback = jest.fn()
        featureFlags.getRemoteConfigPayload('test-flag', callback)

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
    })

    it('should not include evaluation_contexts when not configured', () => {
        const callback = jest.fn()
        featureFlags.getRemoteConfigPayload('test-flag', callback)

        expect(instance._send_request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'POST',
                url: 'flags/flags/?v=2',
                data: expect.objectContaining({
                    distinct_id: 'test-distinct-id',
                    token: 'test-token',
                }),
            })
        )

        // Verify evaluation_contexts is not in the data
        expect(instance._send_request.mock.calls[0][0].data.evaluation_contexts).toBeUndefined()
    })

    it('should not include evaluation_contexts when configured as empty array', () => {
        instance.config.evaluation_contexts = []

        const callback = jest.fn()
        featureFlags.getRemoteConfigPayload('test-flag', callback)

        expect(instance._send_request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'POST',
                url: 'flags/flags/?v=2',
                data: expect.objectContaining({
                    distinct_id: 'test-distinct-id',
                    token: 'test-token',
                }),
            })
        )

        // Verify evaluation_contexts is not in the data
        expect(instance._send_request.mock.calls[0][0].data.evaluation_contexts).toBeUndefined()
    })

    it('should support deprecated evaluation_environments field', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

        instance.config.evaluation_environments = ['staging', 'backend']

        const callback = jest.fn()
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
                _send_request: jest.fn(),
                requestRouter: new RequestRouter({ config: apiConfig } as any),
            })

            const customFeatureFlags = new PostHogFeatureFlags(customInstance)
            const callback = jest.fn()
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
                _send_request: jest.fn(),
                requestRouter: new RequestRouter({
                    config: {
                        api_host: 'https://app.posthog.com',
                    },
                } as any),
            })

            const customFeatureFlags = new PostHogFeatureFlags(customInstance)
            const callback = jest.fn()
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
        jest.spyOn(window.console, 'warn').mockImplementation()
    })

    it('should update feature flags without making a network request', async () => {
        const posthog = await createPosthogInstance()

        posthog.updateFlags({
            'test-flag': true,
            'variant-flag': 'control',
        })

        expect(posthog.getFeatureFlag('test-flag')).toBe(true)
        expect(posthog.getFeatureFlag('variant-flag')).toBe('control')
        expect(posthog.isFeatureEnabled('test-flag')).toBe(true)
    })

    it('should update feature flags with payloads', async () => {
        const posthog = await createPosthogInstance()

        posthog.updateFlags({ 'test-flag': true }, { 'test-flag': { some: 'payload' } })

        expect(posthog.getFeatureFlagPayload('test-flag')).toEqual({ some: 'payload' })
    })

    it('should return flag result with value and payload via getFeatureFlagResult', async () => {
        const posthog = await createPosthogInstance()

        posthog.updateFlags(
            { 'boolean-flag': true, 'variant-flag': 'control', 'disabled-flag': false },
            { 'boolean-flag': { discount: 10 }, 'variant-flag': { version: 'a' } }
        )

        const booleanResult = posthog.getFeatureFlagResult('boolean-flag', { send_event: false })
        expect(booleanResult).toEqual({
            key: 'boolean-flag',
            enabled: true,
            variant: undefined,
            payload: { discount: 10 },
        })

        const variantResult = posthog.getFeatureFlagResult('variant-flag', { send_event: false })
        expect(variantResult).toEqual({
            key: 'variant-flag',
            enabled: true,
            variant: 'control',
            payload: { version: 'a' },
        })

        const disabledResult = posthog.getFeatureFlagResult('disabled-flag', { send_event: false })
        expect(disabledResult).toEqual({
            key: 'disabled-flag',
            enabled: false,
            variant: undefined,
            payload: undefined,
        })

        const missingResult = posthog.getFeatureFlagResult('non-existent', { send_event: false })
        expect(missingResult).toBeUndefined()
    })

    // Note: Falsy payload values (null, 0, false, '') are filtered out by normalizeFlagsResponse
    // This is consistent with existing SDK behavior for all feature flag payloads

    it('should fire onFeatureFlags callbacks when flags are updated', async () => {
        const posthog = await createPosthogInstance()
        const callback = jest.fn()
        posthog.onFeatureFlags(callback)

        posthog.updateFlags({ 'new-flag': true })

        expect(callback).toHaveBeenCalledWith(['new-flag'], { 'new-flag': true }, { errorsLoading: undefined })
    })

    it('should replace existing flags by default', async () => {
        const posthog = await createPosthogInstance()

        // Set initial flags
        posthog.updateFlags({ 'flag-a': true, 'flag-b': true })

        expect(posthog.getFeatureFlag('flag-a')).toBe(true)
        expect(posthog.getFeatureFlag('flag-b')).toBe(true)

        // Update without merge - should replace
        posthog.updateFlags({ 'flag-c': true })

        expect(posthog.getFeatureFlag('flag-c')).toBe(true)
        expect(posthog.getFeatureFlag('flag-a')).toBe(undefined)
        expect(posthog.getFeatureFlag('flag-b')).toBe(undefined)
    })

    it('should merge flags when merge option is true', async () => {
        const posthog = await createPosthogInstance()

        // Set initial flags
        posthog.updateFlags({ 'flag-a': true, 'flag-b': true })

        expect(posthog.getFeatureFlag('flag-a')).toBe(true)
        expect(posthog.getFeatureFlag('flag-b')).toBe(true)

        // Update with merge - should keep existing flags
        posthog.updateFlags({ 'flag-c': true }, undefined, { merge: true })

        expect(posthog.getFeatureFlag('flag-a')).toBe(true)
        expect(posthog.getFeatureFlag('flag-b')).toBe(true)
        expect(posthog.getFeatureFlag('flag-c')).toBe(true)
    })

    it('should merge payloads when merge option is true', async () => {
        const posthog = await createPosthogInstance()

        // Set initial flags with payloads
        posthog.updateFlags({ 'flag-a': true, 'flag-b': true }, { 'flag-a': { data: 'a' }, 'flag-b': { data: 'b' } })

        expect(posthog.getFeatureFlagPayload('flag-a')).toEqual({ data: 'a' })
        expect(posthog.getFeatureFlagPayload('flag-b')).toEqual({ data: 'b' })

        // Update with merge - should keep existing payloads
        posthog.updateFlags({ 'flag-c': true }, { 'flag-c': { data: 'c' } }, { merge: true })

        expect(posthog.getFeatureFlagPayload('flag-a')).toEqual({ data: 'a' })
        expect(posthog.getFeatureFlagPayload('flag-b')).toEqual({ data: 'b' })
        expect(posthog.getFeatureFlagPayload('flag-c')).toEqual({ data: 'c' })
    })

    it('should override existing flag values when merging', async () => {
        const posthog = await createPosthogInstance()

        // Set initial flags
        posthog.updateFlags({ 'flag-a': true, 'flag-b': 'variant-1' })

        // Update flag-a with merge - should override just flag-a
        posthog.updateFlags({ 'flag-a': false }, undefined, { merge: true })

        expect(posthog.getFeatureFlag('flag-a')).toBe(false)
        expect(posthog.getFeatureFlag('flag-b')).toBe('variant-1')
    })

    it('should mark flags as loaded after update', async () => {
        const posthog = await createPosthogInstance()

        posthog.updateFlags({ 'test-flag': true })

        expect(posthog.featureFlags._hasLoadedFlags).toBe(true)
    })

    it('should work with advanced_disable_flags enabled', async () => {
        const posthog = await createPosthogInstance(undefined, {
            advanced_disable_flags: true,
        })

        posthog.updateFlags({ 'test-flag': true })

        expect(posthog.isFeatureEnabled('test-flag')).toBe(true)
    })

    it('should not make any network requests', async () => {
        const posthog = await createPosthogInstance()
        const sendRequestSpy = jest.spyOn(posthog, '_send_request')

        posthog.updateFlags({ 'test-flag': true })

        expect(sendRequestSpy).not.toHaveBeenCalled()
    })

    it('should handle empty flags object', async () => {
        const posthog = await createPosthogInstance()

        // Set initial flags
        posthog.updateFlags({ 'flag-a': true, 'flag-b': 'variant-1' })
        expect(posthog.getFeatureFlag('flag-a')).toBe(true)

        // Update with empty object - should clear all flags
        posthog.updateFlags({})

        expect(posthog.getFeatureFlag('flag-a')).toBe(undefined)
        expect(posthog.getFeatureFlag('flag-b')).toBe(undefined)
        expect(posthog.featureFlags.getFlags()).toEqual([])
    })

    it('should persist flags to storage', async () => {
        const posthog = await createPosthogInstance()

        posthog.updateFlags(
            { 'persisted-flag': true, 'variant-flag': 'control' },
            { 'persisted-flag': { data: 'test' } }
        )

        // Verify persistence was updated with correct data
        expect(posthog.persistence?.props.$feature_flag_details).toEqual({
            'persisted-flag': {
                key: 'persisted-flag',
                enabled: true,
                variant: undefined,
                reason: undefined,
                metadata: {
                    id: 0,
                    version: undefined,
                    description: undefined,
                    payload: { data: 'test' },
                },
            },
            'variant-flag': {
                key: 'variant-flag',
                enabled: true,
                variant: 'control',
                reason: undefined,
                metadata: undefined,
            },
        })
        expect(posthog.persistence?.props.$enabled_feature_flags).toEqual({
            'persisted-flag': true,
            'variant-flag': 'control',
        })
        expect(posthog.persistence?.props.$active_feature_flags).toEqual(['persisted-flag', 'variant-flag'])
    })
})

describe('$feature_flag_error tracking', () => {
    let instance: any
    let featureFlags: PostHogFeatureFlags
    let mockWarn: jest.SpyInstance

    const config = {
        token: 'random fake token',
        persistence: 'memory',
        api_host: 'https://app.posthog.com',
    } as PostHogConfig

    beforeEach(() => {
        const internalEventEmitter = new SimpleEventEmitter()
        instance = {
            config: { ...config },
            get_distinct_id: () => 'blah id',
            getGroups: () => {},
            persistence: new PostHogPersistence(config),
            requestRouter: new RequestRouter({ config } as any),
            register: (props: any) => instance.persistence.register(props),
            unregister: (key: string) => instance.persistence.unregister(key),
            get_property: (key: string) => instance.persistence.props[key],
            capture: jest.fn(),
            _send_request: jest.fn(),
            _onRemoteConfig: jest.fn(),
            reloadFeatureFlags: () => featureFlags.reloadFeatureFlags(),
            _shouldDisableFlags: () => false,
            _internalEventEmitter: internalEventEmitter,
            on: (event: string, cb: (...args: any[]) => void) => internalEventEmitter.on(event, cb),
        }

        featureFlags = new PostHogFeatureFlags(instance)
        mockWarn = jest.spyOn(window.console, 'warn').mockImplementation()
        instance.persistence.unregister('$flag_call_reported')
        instance.persistence.unregister('$feature_flag_errors')
    })

    afterEach(() => {
        mockWarn.mockRestore()
        jest.clearAllMocks()
    })

    it('should set $feature_flag_error to api_error_{status} on server error', () => {
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 500,
                json: {},
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        expect(instance.persistence.props.$feature_flag_errors).toEqual(['api_error_500'])
    })

    it('should set $feature_flag_error to connection_error on network failure', () => {
        const networkError = new Error('Network request failed')
        networkError.name = 'TypeError'

        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 0,
                error: networkError,
                json: null,
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        expect(instance.persistence.props.$feature_flag_errors).toEqual([FeatureFlagError.CONNECTION_ERROR])
    })

    it('should set $feature_flag_error to timeout when request times out (AbortError)', () => {
        const abortError = new Error('Aborted')
        abortError.name = 'AbortError'

        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 0,
                error: abortError,
                json: null,
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        expect(instance.persistence.props.$feature_flag_errors).toEqual([FeatureFlagError.TIMEOUT])
    })

    it('should set $feature_flag_error to errors_while_computing_flags when errorsWhileComputingFlags is true', () => {
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 200,
                json: {
                    flags: {
                        'test-flag': { key: 'test-flag', enabled: true },
                    },
                    errorsWhileComputingFlags: true,
                },
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        expect(instance.persistence.props.$feature_flag_errors).toEqual([FeatureFlagError.ERRORS_WHILE_COMPUTING])
    })

    it('should set $feature_flag_error to quota_limited when quota limited', () => {
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 200,
                json: {
                    flags: {},
                    quotaLimited: ['feature_flags'],
                },
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        expect(instance.persistence.props.$feature_flag_errors).toEqual([FeatureFlagError.QUOTA_LIMITED])
    })

    it('should set $feature_flag_error to unknown_error when error is not an Error instance', () => {
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 0,
                error: 'String error message',
                json: null,
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        expect(instance.persistence.props.$feature_flag_errors).toEqual([FeatureFlagError.UNKNOWN_ERROR])
    })

    it.each([401, 403, 404, 502, 503])('should set $feature_flag_error to api_error_%i for status %i', (status) => {
        instance._send_request = jest
            .fn()
            .mockImplementation(({ callback }) => callback({ statusCode: status, json: {} }))

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        expect(instance.persistence.props.$feature_flag_errors).toEqual([`api_error_${status}`])
    })

    it('should include $feature_flag_error in $feature_flag_called event capture', () => {
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 200,
                json: {
                    flags: {
                        'test-flag': { key: 'test-flag', enabled: true },
                    },
                    errorsWhileComputingFlags: true,
                },
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        featureFlags.getFeatureFlag('test-flag')

        expect(instance.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag: 'test-flag',
                $feature_flag_response: true,
                $feature_flag_error: FeatureFlagError.ERRORS_WHILE_COMPUTING,
            })
        )
    })

    it('should set $feature_flag_error to flag_missing when flag is not in response', () => {
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 200,
                json: {
                    flags: {
                        'other-flag': { key: 'other-flag', enabled: true },
                    },
                },
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        featureFlags.getFeatureFlag('non-existent-flag')

        expect(instance.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag: 'non-existent-flag',
                $feature_flag_response: undefined,
                $feature_flag_error: FeatureFlagError.FLAG_MISSING,
            })
        )
    })

    it('should join multiple errors with commas', () => {
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 200,
                json: {
                    flags: {},
                    errorsWhileComputingFlags: true,
                },
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        // Flag is not in response, and errorsWhileComputingFlags is true
        featureFlags.getFeatureFlag('missing-flag')

        expect(instance.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag: 'missing-flag',
                $feature_flag_response: undefined,
                $feature_flag_error: `${FeatureFlagError.ERRORS_WHILE_COMPUTING},${FeatureFlagError.FLAG_MISSING}`,
            })
        )
    })

    it('should not include $feature_flag_error when there are no errors', () => {
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 200,
                json: {
                    flags: {
                        'success-flag': { key: 'success-flag', enabled: true },
                    },
                    errorsWhileComputingFlags: false,
                },
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        featureFlags.getFeatureFlag('success-flag')

        expect(instance.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.not.objectContaining({
                $feature_flag_error: expect.anything(),
            })
        )
    })

    it('should clear errors on successful subsequent request', () => {
        // First request with error
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 500,
                json: {},
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        expect(instance.persistence.props.$feature_flag_errors).toEqual(['api_error_500'])

        // Second successful request
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 200,
                json: {
                    flags: {
                        'success-flag': { key: 'success-flag', enabled: true },
                    },
                },
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        expect(instance.persistence.props.$feature_flag_errors).toEqual([])
    })

    it('should track quota_limited and flag_missing together', () => {
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 200,
                json: {
                    flags: {},
                    quotaLimited: ['feature_flags'],
                },
            })
        )

        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        featureFlags.getFeatureFlag('some-flag')

        expect(instance.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag: 'some-flag',
                $feature_flag_response: undefined,
                $feature_flag_error: `${FeatureFlagError.QUOTA_LIMITED},${FeatureFlagError.FLAG_MISSING}`,
            })
        )
    })

    it('should include persisted errors in $feature_flag_called event after reload', () => {
        // Setup: flags loaded with errors_while_computing
        instance._send_request = jest.fn().mockImplementation(({ callback }) =>
            callback({
                statusCode: 200,
                json: {
                    flags: { 'test-flag': { key: 'test-flag', enabled: true } },
                    errorsWhileComputingFlags: true,
                },
            })
        )
        featureFlags.reloadFeatureFlags()
        jest.advanceTimersByTime(10)

        // Simulate reload - new FeatureFlags instance with same persistence
        const newFeatureFlags = new PostHogFeatureFlags(instance)

        // Getting flag should include persisted error
        newFeatureFlags.getFeatureFlag('test-flag')

        expect(instance.capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
                $feature_flag: 'test-flag',
                $feature_flag_error: FeatureFlagError.ERRORS_WHILE_COMPUTING,
            })
        )
    })
})
