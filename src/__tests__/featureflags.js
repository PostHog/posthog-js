import { PostHogFeatureFlags, parseFeatureFlagDecideResponse } from '../posthog-featureflags'
jest.useFakeTimers()
jest.spyOn(global, 'setTimeout')

describe('featureflags', () => {
    given('decideEndpointWasHit', () => false)
    given('instance', () => ({
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        get_distinct_id: () => 'blah id',
        getGroups: () => {},
        _prepare_callback: (callback) => callback,
        persistence: {
            props: {
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
            },
            register: (dict) => {
                given.instance.persistence.props = { ...given.instance.persistence.props, ...dict }
            },
        },
        get_property: (key) => given.instance.persistence.props[key],
        capture: () => {},
        decideEndpointWasHit: given.decideEndpointWasHit,
        _send_request: jest.fn().mockImplementation((url, data, headers, callback) => callback(given.decideResponse)),
    }))

    given('featureFlags', () => new PostHogFeatureFlags(given.instance))

    beforeEach(() => {
        jest.spyOn(given.instance, 'capture').mockReturnValue()
        jest.spyOn(window.console, 'warn').mockImplementation()
    })

    it('should return the right feature flag and call capture', () => {
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
    })

    it('should return the right feature flag and not call capture', () => {
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

        given('config', () => ({
            token: 'random fake token',
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

    describe('featurePreviews', () => {
        // actually feature preview response
        const FEATURE_PREVIEW_FIRST = {
            name: 'first',
            description: 'first description',
            stage: 'alpha',
            imageUrl: null,
            documentationUrl: 'http://example.com',
            flagKey: 'first-flag',
        }

        const FEATURE_PREVIEW_SECOND = {
            name: 'second',
            description: 'second description',
            stage: 'alpha',
            imageUrl: null,
            documentationUrl: 'http://example.com',
            flagKey: 'second-flag',
        }

        given('decideResponse', () => ({
            featurePreviews: [FEATURE_PREVIEW_FIRST],
        }))

        given('config', () => ({
            token: 'random fake token',
            api_host: 'https://decide.com/',
        }))

        it('getFeaturePreviews requests previews if not present', () => {
            given.featureFlags.getFeaturePreviews().then((data) => {
                expect(data).toEqual([FEATURE_PREVIEW_FIRST])
            })

            expect(given.instance._send_request).toHaveBeenCalledWith("https://decide.com//feature_previews/?token=random fake token", {}, {"method": "GET"}, expect.any(Function))
            expect(given.instance._send_request).toHaveBeenCalledTimes(1)

            expect(given.instance.persistence.props.$feature_previews).toEqual(
                [FEATURE_PREVIEW_FIRST]
            )

            given('decideResponse', () => ({
                featurePreviews: [FEATURE_PREVIEW_SECOND],
            }))

            // request again, shouldn't call _send_request again
            given.featureFlags.getFeaturePreviews().then((data) => {
                expect(data).toEqual([FEATURE_PREVIEW_FIRST])
            })
            expect(given.instance._send_request).toHaveBeenCalledTimes(1)
        })

        it('getFeaturePreviews force reloads previews when asked to', () => {
            given.featureFlags.getFeaturePreviews().then((data) => {
                expect(data).toEqual([FEATURE_PREVIEW_FIRST])
            })

            expect(given.instance._send_request).toHaveBeenCalledWith("https://decide.com//feature_previews/?token=random fake token", {}, {"method": "GET"}, expect.any(Function))
            expect(given.instance._send_request).toHaveBeenCalledTimes(1)

            expect(given.instance.persistence.props.$feature_previews).toEqual(
                [FEATURE_PREVIEW_FIRST]
            )

            given('decideResponse', () => ({
                featurePreviews: [FEATURE_PREVIEW_SECOND],
            }))

            // request again, should call _send_request because we're forcing a reload
            given.featureFlags.getFeaturePreviews(true).then((data) => {
                expect(data).toEqual([FEATURE_PREVIEW_SECOND])
            })
            expect(given.instance._send_request).toHaveBeenCalledTimes(2)

        })

        it('update enrollment should update the feature preview enrollment', () => {
            given.featureFlags.updateFeaturePreviewEnrollment('first-flag', true)

            expect(given.instance.capture).toHaveBeenCalledTimes(1)
            expect(given.instance.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: true,
                $feature_flag: 'first-flag',
                $set: {
                    "$feature_enrollment/first-flag": true,
                }
            })

            expect(given.featureFlags.getFlagVariants()).toEqual({
                "alpha-feature-2": true,
                "beta-feature": true,
                "disabled-flag": false,
                "multivariate-flag": "variant-1",
                // feature preview flag is added to list of flags
                'first-flag': true,
            })

            // now enrollment is turned off
            given.featureFlags.updateFeaturePreviewEnrollment('first-flag', false)

            expect(given.instance.capture).toHaveBeenCalledTimes(2)
            expect(given.instance.capture).toHaveBeenCalledWith('$feature_enrollment_update', {
                $feature_enrollment: false,
                $feature_flag: 'first-flag',
                $set: {
                    "$feature_enrollment/first-flag": false,
                }
            })

            expect(given.featureFlags.getFlagVariants()).toEqual({
                "alpha-feature-2": true,
                "beta-feature": true,
                "disabled-flag": false,
                "multivariate-flag": "variant-1",
                // feature preview flag is added to list of flags
                'first-flag': false,
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

        given('config', () => ({
            token: 'random fake token',
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
    })

    describe('when subsequent decide calls return partial results', () => {
        given('decideResponse', () => ({
            featureFlags: { 'x-flag': 'x-value', 'feature-1': false },
            errorsWhileComputingFlags: true,
        }))

        given('config', () => ({
            token: 'random fake token',
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

        given('config', () => ({
            token: 'random fake token',
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
})
