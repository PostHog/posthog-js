import { PostHogFeatureFlags, parseFeatureFlagDecideResponse } from '../posthog-featureflags'

describe('featureflags', () => {
    given('decideEndpointWasHit', () => false)
    given('instance', () => ({
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        get_property: (key) => given.properties[key],
        capture: () => {},
        decideEndpointWasHit: given.decideEndpointWasHit,
    }))

    given('featureFlags', () => new PostHogFeatureFlags(given.instance))

    beforeEach(() => {
        jest.spyOn(given.instance, 'capture').mockReturnValue()
        jest.spyOn(window.console, 'warn').mockImplementation()
    })

    given('properties', () => ({
        $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
        $enabled_feature_flags: {
            'beta-feature': true,
            'alpha-feature-2': true,
            'multivariate-flag': 'variant-1',
        },
        $override_feature_flags: false,
    }))

    it('should return the right feature flag and call capture', () => {
        expect(given.featureFlags.getFlags()).toEqual(['beta-feature', 'alpha-feature-2', 'multivariate-flag'])
        expect(given.featureFlags.getFlagVariants()).toEqual({
            'alpha-feature-2': true,
            'beta-feature': true,
            'multivariate-flag': 'variant-1',
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

    it('supports overrides', () => {
        given('properties', () => ({
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
        }))
        expect(given.featureFlags.getFlags()).toEqual(['alpha-feature-2', 'multivariate-flag'])
        expect(given.featureFlags.getFlagVariants()).toEqual({
            'alpha-feature-2': 'as-a-variant',
            'multivariate-flag': 'variant-1',
        })
    })

    it('onFeatureFlags should not be called immediately if feature flags not loaded', () => {
        var called = false

        given.featureFlags.onFeatureFlags(() => (called = true))
        expect(called).toEqual(false)
    })

    it('onFeatureFlags callback should be called immediately if feature flags were loaded', () => {
        given.featureFlags.instance.decideEndpointWasHit = true
        var called = false
        given.featureFlags.onFeatureFlags(() => (called = true))
        expect(called).toEqual(true)

        called = false
    })
})

describe('parseFeatureFlagDecideResponse', () => {
    given('decideResponse', () => {})
    given('persistence', () => ({ register: jest.fn(), unregister: jest.fn() }))
    given('subject', () => () => parseFeatureFlagDecideResponse(given.decideResponse, given.persistence))

    it('enables multivariate feature flags from decide v2 response', () => {
        given('decideResponse', () => ({
            featureFlags: {
                'beta-feature': true,
                'alpha-feature-2': true,
                'multivariate-flag': 'variant-1',
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
