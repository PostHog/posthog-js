/*eslint @typescript-eslint/no-empty-function: "off" */

import { filterActiveFeatureFlags, parseFeatureFlagDecideResponse, PostHogFeatureFlags } from '../posthog-featureflags'
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
            decideEndpointWasHit: false,
            _send_request: jest.fn().mockImplementation(({ callback }) =>
                callback({
                    statusCode: 200,
                    json: {},
                })
            ),
            _onRemoteConfig: jest.fn(),
            reloadFeatureFlags: () => featureFlags.reloadFeatureFlags(),
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

    it('should return flags from persistence even if decide endpoint was not hit', () => {
        featureFlags._hasLoadedFlags = false

        expect(featureFlags.getFlags()).toEqual([
            'beta-feature',
            'alpha-feature-2',
            'multivariate-flag',
            'disabled-flag',
        ])
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
    })

    it('should warn if decide endpoint was not hit and no flags exist', () => {
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
        expect(featureFlags.isFeatureEnabled('random')).toEqual(false)
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
        expect(featureFlags.isFeatureEnabled('beta-feature')).toEqual(false)
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

    it('supports overrides', () => {
        instance.persistence.props = {
            $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
            $enabled_feature_flags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            },
            $override_feature_flags: {
                'beta-feature': false,
                'alpha-feature-2': 'as-a-variant',
            },
        }

        // should return both true and false flags
        expect(featureFlags.getFlags()).toEqual(['beta-feature', 'alpha-feature-2', 'multivariate-flag'])
        expect(featureFlags.getFlagVariants()).toEqual({
            'alpha-feature-2': 'as-a-variant',
            'multivariate-flag': 'variant-1',
            'beta-feature': false,
        })
    })

    it('supports suppressing override warnings', () => {
        // Setup the initial state
        instance.persistence.props = {
            $active_feature_flags: ['beta-feature', 'alpha-feature-2'],
            $enabled_feature_flags: {
                'beta-feature': true,
                'alpha-feature-2': true,
            },
        }
        // Mark the instance as loaded
        instance.__loaded = true

        // Test without suppressing warning (default behavior)
        featureFlags.override({
            'beta-feature': false,
        })

        // Verify that the override took effect
        expect(featureFlags.getFlagVariants()).toEqual({
            'beta-feature': false,
            'alpha-feature-2': true,
        })
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            ' Overriding feature flags!',
            expect.any(Object)
        )

        // Clear the mock to reset call count
        mockWarn.mockClear()

        // Test with suppressing warning (new behavior)
        featureFlags.override(
            {
                'alpha-feature-2': false,
            },
            true
        )

        expect(window.console.warn).not.toHaveBeenCalled()

        // Verify that the override took effect even with no logs
        expect(featureFlags.getFlagVariants()).toEqual({
            'beta-feature': true,
            'alpha-feature-2': false,
        })
    })

    describe('decide()', () => {
        it('should not call decide if advanced_disable_decide is true', () => {
            instance.config.advanced_disable_decide = true
            featureFlags.decide()

            expect(instance._send_request).toHaveBeenCalledTimes(0)
        })

        it('should call decide', () => {
            featureFlags.decide()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(undefined)

            jest.runOnlyPendingTimers()
            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('should call decide with flags disabled if set', () => {
            instance.config.advanced_disable_feature_flags_on_first_load = true
            featureFlags.decide()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(true)
        })

        it('should call decide with flags disabled if set generally', () => {
            instance.config.advanced_disable_feature_flags = true
            featureFlags.decide()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(true)
        })

        it('should call decide once even if reload called before', () => {
            featureFlags.reloadFeatureFlags()
            featureFlags.decide()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(undefined)

            jest.runOnlyPendingTimers()
            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('should not disable flags if reload was called on decide', () => {
            instance.config.advanced_disable_feature_flags_on_first_load = true
            featureFlags.reloadFeatureFlags()
            featureFlags.decide()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(undefined)

            jest.runOnlyPendingTimers()
            expect(instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('should always disable flags if set', () => {
            instance.config.advanced_disable_feature_flags = true
            featureFlags.reloadFeatureFlags()
            featureFlags.decide()

            expect(instance._send_request).toHaveBeenCalledTimes(1)
            expect(instance._send_request.mock.calls[0][0].data.disable_flags).toBe(true)
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
            })

            featureFlags.reloadFeatureFlags()
            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            // check the request didn't send $anon_distinct_id the second time around
            expect(instance._send_request.mock.calls[1][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                // $anon_distinct_id: "rando_id"
            })

            featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            // check the request didn't send $anon_distinct_id the second time around
            expect(instance._send_request.mock.calls[2][0].data).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                // $anon_distinct_id: "rando_id"
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

    describe('when subsequent decide calls return partial results', () => {
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

    describe('when subsequent decide calls return results without errors', () => {
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

    describe('when decide times out or errors out', () => {
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

        it('should call onFeatureFlags even when decide errors out', () => {
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
})

describe('parseFeatureFlagDecideResponse', () => {
    let persistence

    beforeEach(() => {
        persistence = { register: jest.fn(), unregister: jest.fn() }
    })

    it('enables multivariate feature flags from decide v2^ response', () => {
        const decideResponse = {
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
        parseFeatureFlagDecideResponse(decideResponse, persistence)

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
        })
    })

    it('enables feature flags from decide response (v1 backwards compatibility)', () => {
        // checks that nothing fails when asking for ?v=2 and getting a ?v=1 response
        const decideResponse = { featureFlags: ['beta-feature', 'alpha-feature-2'] }

        // @ts-expect-error testing backwards compatibility
        parseFeatureFlagDecideResponse(decideResponse, persistence)

        expect(persistence.register).toHaveBeenLastCalledWith({
            $active_feature_flags: ['beta-feature', 'alpha-feature-2'],
            $enabled_feature_flags: { 'beta-feature': true, 'alpha-feature-2': true },
        })
    })

    it('doesnt remove existing feature flags when no flags are returned', () => {
        parseFeatureFlagDecideResponse({}, persistence)

        expect(persistence.register).not.toHaveBeenCalled()
        expect(persistence.unregister).not.toHaveBeenCalled()
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
