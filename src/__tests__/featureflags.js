/*eslint @typescript-eslint/no-empty-function: "off" */

import { PostHogFeatureFlags, parseFeatureFlagDecideResponse, filterActiveFeatureFlags } from '../posthog-featureflags'
import { PostHogPersistence } from '../posthog-persistence'
import { RequestRouter } from '../utils/request-router'

jest.useFakeTimers()
jest.spyOn(global, 'setTimeout')

describe('featureflags', () => {
    given('decideEndpointWasHit', () => false)

    const config = {
        token: 'random fake token',
        persistence: 'memory',
        api_host: 'https://app.posthog.com',
    }
    given('instance', () => ({
        config,
        get_distinct_id: () => 'blah id',
        getGroups: () => {},
        _prepare_callback: (callback) => callback,
        persistence: new PostHogPersistence(config),
        requestRouter: new RequestRouter({ config }),
        register: (props) => given.instance.persistence.register(props),
        unregister: (key) => given.instance.persistence.unregister(key),
        get_property: (key) => given.instance.persistence.props[key],
        capture: () => {},
        decideEndpointWasHit: given.decideEndpointWasHit,
        _send_request: jest.fn().mockImplementation((url, data, { callback }) => callback?.(given.decideResponse)),
        reloadFeatureFlags: () => given.featureFlags.reloadFeatureFlags(),
    }))

    given('featureFlags', () => new PostHogFeatureFlags(given.instance))

    beforeEach(() => {
        jest.spyOn(given.instance, 'capture').mockReturnValue()
        jest.spyOn(window.console, 'warn').mockImplementation()

        given.instance.persistence.register({
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

        given.instance.persistence.unregister('$flag_call_reported')
    })

    it('should return flags from persistence even if decide endpoint was not hit', () => {
        given.featureFlags.instance.decideEndpointWasHit = false

        expect(given.featureFlags.getFlags()).toEqual([
            'beta-feature',
            'alpha-feature-2',
            'multivariate-flag',
            'disabled-flag',
        ])
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
    })

    it('should warn if decide endpoint was not hit and no flags exist', () => {
        window.POSTHOG_DEBUG = true
        given.featureFlags.instance.decideEndpointWasHit = false
        given.instance.persistence.unregister('$enabled_feature_flags')
        given.instance.persistence.unregister('$active_feature_flags')

        expect(given.featureFlags.getFlags()).toEqual([])
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(undefined)
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js]',
            'isFeatureEnabled for key "beta-feature" failed. Feature flags didn\'t load in time.'
        )

        window.console.warn.mockClear()

        expect(given.featureFlags.getFeatureFlag('beta-feature')).toEqual(undefined)
        expect(window.console.warn).toHaveBeenCalledWith(
            '[PostHog.js]',
            'getFeatureFlag for key "beta-feature" failed. Feature flags didn\'t load in time.'
        )
    })

    it('should return the right feature flag and call capture', () => {
        given.featureFlags.instance.decideEndpointWasHit = false

        expect(given.featureFlags.getFlags()).toEqual([
            'beta-feature',
            'alpha-feature-2',
            'multivariate-flag',
            'disabled-flag',
        ])
        expect(given.featureFlags.getFlagVariants()).toEqual({
            'alpha-feature-2': true,
            'beta-feature': true,
            'multivariate-flag': 'variant-1',
            'disabled-flag': false,
        })
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(given.featureFlags.isFeatureEnabled('random')).toEqual(false)
        expect(given.featureFlags.isFeatureEnabled('multivariate-flag')).toEqual(true)

        expect(given.instance.capture).toHaveBeenCalledTimes(3)

        // It should not call `capture` on subsequent calls
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(given.instance.capture).toHaveBeenCalledTimes(3)
        expect(given.instance.get_property('$flag_call_reported')).toEqual({
            'beta-feature': ['true'],
            'multivariate-flag': ['variant-1'],
            random: ['undefined'],
        })
    })

    it('should call capture for every different flag response', () => {
        given.featureFlags.instance.decideEndpointWasHit = true

        given.instance.persistence.register({
            $enabled_feature_flags: {
                'beta-feature': true,
            },
        })
        expect(given.featureFlags.getFlags()).toEqual(['beta-feature'])
        expect(given.featureFlags.getFlagVariants()).toEqual({
            'beta-feature': true,
        })
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)

        expect(given.instance.get_property('$flag_call_reported')).toEqual({ 'beta-feature': ['true'] })

        expect(given.instance.capture).toHaveBeenCalledTimes(1)

        // It should not call `capture` on subsequent calls
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(given.instance.capture).toHaveBeenCalledTimes(1)

        given.instance.persistence.register({
            $enabled_feature_flags: {},
        })
        given.featureFlags.instance.decideEndpointWasHit = false
        expect(given.featureFlags.getFlagVariants()).toEqual({})
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(undefined)
        // no extra capture call because flags haven't loaded yet.
        expect(given.instance.capture).toHaveBeenCalledTimes(1)

        given.featureFlags.instance.decideEndpointWasHit = true
        given.instance.persistence.register({
            $enabled_feature_flags: { x: 'y' },
        })
        expect(given.featureFlags.getFlagVariants()).toEqual({ x: 'y' })
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(false)
        expect(given.instance.capture).toHaveBeenCalledTimes(2)

        given.instance.persistence.register({
            $enabled_feature_flags: {
                'beta-feature': 'variant-1',
            },
        })
        expect(given.featureFlags.getFlagVariants()).toEqual({ 'beta-feature': 'variant-1' })
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(given.instance.capture).toHaveBeenCalledTimes(3)

        expect(given.instance.get_property('$flag_call_reported')).toEqual({
            'beta-feature': ['true', 'undefined', 'variant-1'],
        })
    })

    it('should return the right feature flag and not call capture', () => {
        given.featureFlags.instance.decideEndpointWasHit = true

        expect(given.featureFlags.isFeatureEnabled('beta-feature', { send_event: false })).toEqual(true)
        expect(given.instance.capture).not.toHaveBeenCalled()
    })

    it('should return the right payload', () => {
        expect(given.featureFlags.getFeatureFlagPayload('beta-feature')).toEqual({
            some: 'payload',
        })
        expect(given.featureFlags.getFeatureFlagPayload('alpha-feature-2')).toEqual(200)
        expect(given.featureFlags.getFeatureFlagPayload('multivariate-flag')).toEqual(undefined)
        expect(given.instance.capture).not.toHaveBeenCalled()
    })

    it('supports overrides', () => {
        given.instance.persistence.props = {
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

        expect(given.featureFlags.getFlags()).toEqual(['alpha-feature-2', 'multivariate-flag'])
        expect(given.featureFlags.getFlagVariants()).toEqual({
            'alpha-feature-2': 'as-a-variant',
            'multivariate-flag': 'variant-1',
        })
    })

    describe('onFeatureFlags', () => {
        given('decideResponse', () => ({
            featureFlags: {
                first: 'variant-1',
                second: true,
                third: false,
            },
        }))

        it('onFeatureFlags should not be called immediately if feature flags not loaded', () => {
            var called = false
            let _flags = []
            let _variants = {}

            given.featureFlags.onFeatureFlags((flags, variants) => {
                called = true
                _flags = flags
                _variants = variants
            })
            expect(called).toEqual(false)

            given.featureFlags.setAnonymousDistinctId('rando_id')
            given.featureFlags.reloadFeatureFlags()

            jest.runAllTimers()
            expect(called).toEqual(true)
            expect(_flags).toEqual(['first', 'second'])
            expect(_variants).toEqual({
                first: 'variant-1',
                second: true,
            })
        })

        it('onFeatureFlags callback should be called immediately if feature flags were loaded', () => {
            given.featureFlags.instance.decideEndpointWasHit = true
            var called = false
            given.featureFlags.onFeatureFlags(() => (called = true))
            expect(called).toEqual(true)

            called = false
        })

        it('onFeatureFlags should not return flags that are off', () => {
            given.featureFlags.instance.decideEndpointWasHit = true
            let _flags = []
            let _variants = {}
            given.featureFlags.onFeatureFlags((flags, variants) => {
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

            const unsubscribe = given.featureFlags.onFeatureFlags(() => {
                called = true
            })

            given.featureFlags.setAnonymousDistinctId('rando_id')
            given.featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(called).toEqual(true)

            called = false

            unsubscribe()

            given.featureFlags.setAnonymousDistinctId('rando_id')
            given.featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(called).toEqual(false)
        })
    })

    describe('earlyAccessFeatures', () => {
        afterEach(() => {
            given.instance.persistence.clear()
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

        given('decideResponse', () => ({
            earlyAccessFeatures: [EARLY_ACCESS_FEATURE_FIRST],
        }))

        it('getEarlyAccessFeatures requests early access features if not present', () => {
            given.featureFlags.getEarlyAccessFeatures((data) => {
                expect(data).toEqual([EARLY_ACCESS_FEATURE_FIRST])
            })

            expect(given.instance._send_request).toHaveBeenCalledWith(
                'https://us.i.posthog.com/api/early_access_features/?token=random fake token',
                {},
                { method: 'GET', callback: expect.any(Function) }
            )
            expect(given.instance._send_request).toHaveBeenCalledTimes(1)

            expect(given.instance.persistence.props.$early_access_features).toEqual([EARLY_ACCESS_FEATURE_FIRST])

            given('decideResponse', () => ({
                earlyAccessFeatures: [EARLY_ACCESS_FEATURE_SECOND],
            }))

            // request again, shouldn't call _send_request again
            given.featureFlags.getEarlyAccessFeatures((data) => {
                expect(data).toEqual([EARLY_ACCESS_FEATURE_FIRST])
            })
            expect(given.instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('getEarlyAccessFeatures force reloads early access features when asked to', () => {
            given.featureFlags.getEarlyAccessFeatures((data) => {
                expect(data).toEqual([EARLY_ACCESS_FEATURE_FIRST])
            })

            expect(given.instance._send_request).toHaveBeenCalledWith(
                'https://us.i.posthog.com/api/early_access_features/?token=random fake token',
                {},
                { method: 'GET', callback: expect.any(Function) }
            )
            expect(given.instance._send_request).toHaveBeenCalledTimes(1)

            expect(given.instance.persistence.props.$early_access_features).toEqual([EARLY_ACCESS_FEATURE_FIRST])

            given('decideResponse', () => ({
                earlyAccessFeatures: [EARLY_ACCESS_FEATURE_SECOND],
            }))

            // request again, should call _send_request because we're forcing a reload
            given.featureFlags.getEarlyAccessFeatures((data) => {
                expect(data).toEqual([EARLY_ACCESS_FEATURE_SECOND])
            }, true)
            expect(given.instance._send_request).toHaveBeenCalledTimes(2)
        })

        it('update enrollment should update the early access feature enrollment', () => {
            given.featureFlags.updateEarlyAccessFeatureEnrollment('first-flag', true)

            expect(given.instance.capture).toHaveBeenCalledTimes(1)
            expect(given.instance.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: true,
                $feature_flag: 'first-flag',
                $set: {
                    '$feature_enrollment/first-flag': true,
                },
            })

            expect(given.featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
                // early access feature flag is added to list of flags
                'first-flag': true,
            })

            // now enrollment is turned off
            given.featureFlags.updateEarlyAccessFeatureEnrollment('first-flag', false)

            expect(given.instance.capture).toHaveBeenCalledTimes(2)
            expect(given.instance.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: false,
                $feature_flag: 'first-flag',
                $set: {
                    '$feature_enrollment/first-flag': false,
                },
            })

            expect(given.featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
                // early access feature flag is added to list of flags
                'first-flag': false,
            })
        })

        it('reloading flags after update enrollment should send properties', () => {
            given.featureFlags.updateEarlyAccessFeatureEnrollment('x-flag', true)

            expect(given.instance.capture).toHaveBeenCalledTimes(1)
            expect(given.instance.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: true,
                $feature_flag: 'x-flag',
                $set: {
                    '$feature_enrollment/x-flag': true,
                },
            })

            expect(given.featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
                // early access feature flag is added to list of flags
                'x-flag': true,
            })

            given.featureFlags.reloadFeatureFlags()
            jest.runAllTimers()
            // check the request sent person properties
            expect(
                JSON.parse(Buffer.from(given.instance._send_request.mock.calls[0][1].data, 'base64').toString())
            ).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                person_properties: {
                    '$feature_enrollment/x-flag': true,
                },
            })
        })
    })

    describe('reloadFeatureFlags', () => {
        given('decideResponse', () => ({
            featureFlags: {
                first: 'variant-1',
                second: true,
            },
        }))

        it('on providing anonDistinctId', () => {
            given.featureFlags.setAnonymousDistinctId('rando_id')
            given.featureFlags.reloadFeatureFlags()

            jest.runAllTimers()

            expect(given.featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent $anon_distinct_id
            expect(
                JSON.parse(Buffer.from(given.instance._send_request.mock.calls[0][1].data, 'base64').toString())
            ).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: 'rando_id',
            })
        })

        it('on providing anonDistinctId and calling reload multiple times', () => {
            given.featureFlags.setAnonymousDistinctId('rando_id')
            given.featureFlags.reloadFeatureFlags()
            given.featureFlags.reloadFeatureFlags()

            jest.runAllTimers()

            expect(given.featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent $anon_distinct_id
            expect(
                JSON.parse(Buffer.from(given.instance._send_request.mock.calls[0][1].data, 'base64').toString())
            ).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                $anon_distinct_id: 'rando_id',
            })

            given.featureFlags.reloadFeatureFlags()
            given.featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            // check the request didn't send $anon_distinct_id the second time around
            expect(
                JSON.parse(Buffer.from(given.instance._send_request.mock.calls[1][1].data, 'base64').toString())
            ).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                // $anon_distinct_id: "rando_id"
            })

            given.featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            // check the request didn't send $anon_distinct_id the second time around
            expect(
                JSON.parse(Buffer.from(given.instance._send_request.mock.calls[2][1].data, 'base64').toString())
            ).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                // $anon_distinct_id: "rando_id"
            })
        })

        it('on providing personProperties runs reload automatically', () => {
            given.featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' })

            jest.runAllTimers()

            expect(given.featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent person properties
            expect(
                JSON.parse(Buffer.from(given.instance._send_request.mock.calls[0][1].data, 'base64').toString())
            ).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                person_properties: { a: 'b', c: 'd' },
            })
        })

        it('on providing config advanced_disable_feature_flags', () => {
            given.instance.config = {
                ...given.instance.config,
                advanced_disable_feature_flags: true,
            }
            given.instance.persistence.register({
                $enabled_feature_flags: {
                    'beta-feature': true,
                    'random-feature': 'xatu',
                },
            })

            given.featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            expect(given.featureFlags.getFlagVariants()).toEqual({
                'beta-feature': true,
                'random-feature': 'xatu',
            })

            // check reload request was not sent
            expect(given.instance._send_request).not.toHaveBeenCalled()

            // check the same for other ways to call reload flags

            given.featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' })

            jest.runAllTimers()

            expect(given.featureFlags.getFlagVariants()).toEqual({
                'beta-feature': true,
                'random-feature': 'xatu',
            })

            // check reload request was not sent
            expect(given.instance._send_request).not.toHaveBeenCalled()
        })
    })

    describe('override person and group properties', () => {
        given('decideResponse', () => ({
            featureFlags: {
                first: 'variant-1',
                second: true,
            },
        }))

        it('on providing personProperties updates properties successively', () => {
            given.featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' })
            given.featureFlags.setPersonPropertiesForFlags({ x: 'y', c: 'e' })

            jest.runAllTimers()

            expect(given.featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent person properties
            expect(
                JSON.parse(Buffer.from(given.instance._send_request.mock.calls[0][1].data, 'base64').toString())
            ).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                person_properties: { a: 'b', c: 'e', x: 'y' },
            })
        })

        it('doesnt reload flags if explicitly asked not to', () => {
            given.featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' }, false)

            jest.runAllTimers()

            // still old flags
            expect(given.featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
            })

            expect(given.instance._send_request).not.toHaveBeenCalled()
        })

        it('resetPersonProperties resets all properties', () => {
            given.featureFlags.setPersonPropertiesForFlags({ a: 'b', c: 'd' }, false)
            given.featureFlags.setPersonPropertiesForFlags({ x: 'y', c: 'e' }, false)
            jest.runAllTimers()

            expect(given.instance.persistence.props.$stored_person_properties).toEqual({ a: 'b', c: 'e', x: 'y' })

            given.featureFlags.resetPersonPropertiesForFlags()
            given.featureFlags.reloadFeatureFlags()
            jest.runAllTimers()

            // check the request did not send person properties
            expect(
                JSON.parse(Buffer.from(given.instance._send_request.mock.calls[0][1].data, 'base64').toString())
            ).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
            })
        })

        it('on providing groupProperties updates properties successively', () => {
            given.featureFlags.setGroupPropertiesForFlags({ orgs: { a: 'b', c: 'd' }, projects: { x: 'y', c: 'e' } })

            expect(given.instance.persistence.props.$stored_group_properties).toEqual({
                orgs: { a: 'b', c: 'd' },
                projects: { x: 'y', c: 'e' },
            })

            jest.runAllTimers()

            expect(given.featureFlags.getFlagVariants()).toEqual({
                first: 'variant-1',
                second: true,
            })

            // check the request sent person properties
            expect(
                JSON.parse(Buffer.from(given.instance._send_request.mock.calls[0][1].data, 'base64').toString())
            ).toEqual({
                token: 'random fake token',
                distinct_id: 'blah id',
                group_properties: { orgs: { a: 'b', c: 'd' }, projects: { x: 'y', c: 'e' } },
            })
        })

        it('handles groupProperties updates', () => {
            given.featureFlags.setGroupPropertiesForFlags({ orgs: { a: 'b', c: 'd' }, projects: { x: 'y', c: 'e' } })

            expect(given.instance.persistence.props.$stored_group_properties).toEqual({
                orgs: { a: 'b', c: 'd' },
                projects: { x: 'y', c: 'e' },
            })

            given.featureFlags.setGroupPropertiesForFlags({ orgs: { w: '1' }, other: { z: '2' } })

            expect(given.instance.persistence.props.$stored_group_properties).toEqual({
                orgs: { a: 'b', c: 'd', w: '1' },
                projects: { x: 'y', c: 'e' },
                other: { z: '2' },
            })

            given.featureFlags.resetGroupPropertiesForFlags('orgs')

            expect(given.instance.persistence.props.$stored_group_properties).toEqual({
                orgs: {},
                projects: { x: 'y', c: 'e' },
                other: { z: '2' },
            })

            given.featureFlags.resetGroupPropertiesForFlags()

            expect(given.instance.persistence.props.$stored_group_properties).toEqual(undefined)

            jest.runAllTimers()
        })

        it('doesnt reload group flags if explicitly asked not to', () => {
            given.featureFlags.setGroupPropertiesForFlags({ orgs: { a: 'b', c: 'd' } }, false)

            jest.runAllTimers()

            // still old flags
            expect(given.featureFlags.getFlagVariants()).toEqual({
                'alpha-feature-2': true,
                'beta-feature': true,
                'disabled-flag': false,
                'multivariate-flag': 'variant-1',
            })

            expect(given.instance._send_request).not.toHaveBeenCalled()
        })
    })

    describe('when subsequent decide calls return partial results', () => {
        given('decideResponse', () => ({
            featureFlags: { 'x-flag': 'x-value', 'feature-1': false },
            errorsWhileComputingFlags: true,
        }))

        it('should return combined results', () => {
            given.featureFlags.reloadFeatureFlags()

            jest.runAllTimers()

            expect(given.featureFlags.getFlagVariants()).toEqual({
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
        given('decideResponse', () => ({
            featureFlags: { 'x-flag': 'x-value', 'feature-1': false },
            errorsWhileComputingFlags: false,
        }))

        it('should return combined results', () => {
            given.featureFlags.reloadFeatureFlags()

            jest.runAllTimers()

            expect(given.featureFlags.getFlagVariants()).toEqual({
                'x-flag': 'x-value',
                'feature-1': false,
            })
        })
    })
})

describe('parseFeatureFlagDecideResponse', () => {
    given('decideResponse', () => {})
    given('persistence', () => ({ register: jest.fn(), unregister: jest.fn() }))
    given('subject', () => () => parseFeatureFlagDecideResponse(given.decideResponse, given.persistence))

    it('enables multivariate feature flags from decide v2^ response', () => {
        given('decideResponse', () => ({
            featureFlags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
            },
            featureFlagPayloads: {
                'beta-feature': 300,
                'alpha-feature-2': 'fake-payload',
            },
        }))
        given.subject()

        expect(given.persistence.register).toHaveBeenCalledWith({
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
        given('decideResponse', () => ({ featureFlags: ['beta-feature', 'alpha-feature-2'] }))
        given.subject()

        expect(given.persistence.register).toHaveBeenLastCalledWith({
            $active_feature_flags: ['beta-feature', 'alpha-feature-2'],
            $enabled_feature_flags: { 'beta-feature': true, 'alpha-feature-2': true },
        })
    })

    it('doesnt remove existing feature flags when no flags are returned', () => {
        given('decideResponse', () => ({ status: 0 }))
        given.subject()

        expect(given.persistence.register).not.toHaveBeenCalled()
        expect(given.persistence.unregister).not.toHaveBeenCalled()
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
