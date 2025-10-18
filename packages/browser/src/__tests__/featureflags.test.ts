/*eslint @typescript-eslint/no-empty-function: "off" */

import { filterActiveFeatureFlags, parseFlagsResponse, PostHogFeatureFlags } from '../posthog-featureflags'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'
import { PostHogConfig } from '../types'

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

    describe('flags()', () => {
        it('should not call /flags if advanced_disable_decide is true', () => {
            instance.config.advanced_disable_decide = true
            featureFlags.flags()

            expect(instance._send_request).toHaveBeenCalledTimes(0)
        })

        it('should not call /flags if advanced_disable_flags is true', () => {
            instance.config.advanced_disable_flags = true
            featureFlags.flags()

            expect(instance._send_request).toHaveBeenCalledTimes(0)
        })

        it('should call /flags', () => {
            featureFlags.flags()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(undefined)

            jest.runOnlyPendingTimers()
            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('should call /flags with flags disabled if set', () => {
            instance.config.advanced_disable_feature_flags_on_first_load = true
            featureFlags.flags()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(true)
        })

        it('should call /flags with flags disabled if set generally', () => {
            instance.config.advanced_disable_feature_flags = true
            featureFlags.flags()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(true)
        })

        it('should call /flags once even if reload called before', () => {
            featureFlags.reloadFeatureFlags()
            featureFlags.flags()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(undefined)

            jest.runOnlyPendingTimers()
            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('should not disable flags if reload was called on /flags', () => {
            instance.config.advanced_disable_feature_flags_on_first_load = true
            featureFlags.reloadFeatureFlags()
            featureFlags.flags()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(undefined)

            jest.runOnlyPendingTimers()
            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('should always disable flags if set', () => {
            instance.config.advanced_disable_feature_flags = true
            featureFlags.reloadFeatureFlags()
            featureFlags.flags()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(true)
        })

        it('should call /flags with evaluation_environments when configured', () => {
            instance.config.evaluation_environments = ['production', 'web']
            featureFlags.flags()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.evaluation_environments).toEqual(['production', 'web'])
        })

        it('should not include evaluation_environments when not configured', () => {
            featureFlags.flags()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.evaluation_environments).toBe(undefined)
        })

        it('should not include evaluation_environments when configured as empty array', () => {
            instance.config.evaluation_environments = []
            featureFlags.flags()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.evaluation_environments).toBe(undefined)
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
                person_properties: {
                    '$feature_enrollment/x-flag': true,
                },
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
                person_properties: {},
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
                person_properties: {},
            })

            featureFlags.reloadFeatureFlags()
            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            // check the request didn't send $anon_distinct_id the second time around
            expect(instance._send_request.mock.calls[1][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                person_properties: {},
            })

            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            // check the request didn't send $anon_distinct_id the second time around
            expect(instance._send_request.mock.calls[2][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                person_properties: {},
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
                person_properties: { a: 'b', c: 'd' },
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
                person_properties: { a: 'b', c: 'e', x: 'y' },
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
                person_properties: {},
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
                person_properties: {},
                group_properties: { orgs: { a: 'b', c: 'd' }, projects: { x: 'y', c: 'e' } },
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

    describe('Feature Flag Request ID', () => {
        const TEST_REQUEST_ID = 'test-request-id-123'

        it('saves requestId from /flags response', () => {
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                requestId: TEST_REQUEST_ID,
            })

            expect(instance.get_property('$feature_flag_request_id')).toEqual(TEST_REQUEST_ID)
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

        it('includes version in feature flag called event', () => {
            // Setup flags with requestId
            featureFlags.receivedFeatureFlags({
                featureFlags: { 'test-flag': true },
                featureFlagPayloads: {},
                requestId: TEST_REQUEST_ID,
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

            // Verify capture call includes requestId
            expect(instance.capture).toHaveBeenCalledWith(
                '$feature_flag_called',
                expect.objectContaining({
                    $feature_flag: 'test-flag',
                    $feature_flag_response: 'variant-1',
                    $feature_flag_request_id: TEST_REQUEST_ID,
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
        instance = {
            config: {
                token: 'test-token',
                api_host: 'https://test.com',
            } as PostHogConfig,
            get_distinct_id: () => 'test-distinct-id',
            _send_request: jest.fn(),
            requestRouter: {
                endpointFor: jest.fn().mockImplementation((endpoint, path) => `${endpoint}${path}`),
            },
        } as unknown as PostHog

        featureFlags = new PostHogFeatureFlags(instance)
    })

    it('should include evaluation_environments when configured', () => {
        instance.config.evaluation_environments = ['staging', 'backend']

        const callback = jest.fn()
        featureFlags.getRemoteConfigPayload('test-flag', callback)

        expect(instance._send_request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'POST',
                url: 'flags/flags/?v=2&config=true',
                data: expect.objectContaining({
                    distinct_id: 'test-distinct-id',
                    token: 'test-token',
                    evaluation_environments: ['staging', 'backend'],
                }),
            })
        )
    })

    it('should not include evaluation_environments when not configured', () => {
        const callback = jest.fn()
        featureFlags.getRemoteConfigPayload('test-flag', callback)

        expect(instance._send_request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'POST',
                url: 'flags/flags/?v=2&config=true',
                data: expect.objectContaining({
                    distinct_id: 'test-distinct-id',
                    token: 'test-token',
                }),
            })
        )

        // Verify evaluation_environments is not in the data
        expect(instance._send_request.mock.calls[0][0].data.evaluation_environments).toBeUndefined()
    })

    it('should not include evaluation_environments when configured as empty array', () => {
        instance.config.evaluation_environments = []

        const callback = jest.fn()
        featureFlags.getRemoteConfigPayload('test-flag', callback)

        expect(instance._send_request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'POST',
                url: 'flags/flags/?v=2&config=true',
                data: expect.objectContaining({
                    distinct_id: 'test-distinct-id',
                    token: 'test-token',
                }),
            })
        )

        // Verify evaluation_environments is not in the data
        expect(instance._send_request.mock.calls[0][0].data.evaluation_environments).toBeUndefined()
    })

    describe('flags_api_host configuration', () => {
        it('should use flags_api_host when configured', () => {
            const apiConfig = {
                api_host: 'https://app.posthog.com',
                flags_api_host: 'https://example.com/feature-flags',
            }
            const customInstance = {
                config: {
                    token: 'test-token',
                    ...apiConfig,
                } as PostHogConfig,
                get_distinct_id: () => 'test-distinct-id',
                _send_request: jest.fn(),
                requestRouter: new RequestRouter({ config: apiConfig } as any),
            } as unknown as PostHog

            const customFeatureFlags = new PostHogFeatureFlags(customInstance)
            const callback = jest.fn()
            customFeatureFlags.getRemoteConfigPayload('test-flag', callback)

            expect(customInstance._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'POST',
                    url: 'https://example.com/feature-flags/flags/?v=2&config=true',
                })
            )
        })

        it('should fall back to api_host when flags_api_host is not configured', () => {
            const customInstance = {
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
            } as unknown as PostHog

            const customFeatureFlags = new PostHogFeatureFlags(customInstance)
            const callback = jest.fn()
            customFeatureFlags.getRemoteConfigPayload('test-flag', callback)

            expect(customInstance._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'POST',
                    url: 'https://us.i.posthog.com/flags/?v=2&config=true',
                })
            )
        })
    })
})
