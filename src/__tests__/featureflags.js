import { PostHogFeatureFlags } from '../posthog-featureflags'

describe('featureflags', () => {
    given('instance', () => ({
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        get_property: (key) => given.properties[key],
        capture: () => {},
    }))

    given('featureFlags', () => new PostHogFeatureFlags(given.instance))

    beforeEach(() => {
        jest.spyOn(given.instance, 'capture').mockReturnValue()
    })

    given('properties', () => ({
        $active_feature_flags: ['beta-feature', 'alpha-feature-2', 'multivariate-flag'],
        $enabled_feature_flags: {
            'beta-feature': true,
            'alpha-feature-2': true,
            'multivariate-flag': 'variant-1',
        },
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

    it('should propertly merge overridden feature flags', () => {})

    it('should return the right feature flag and not call capture', () => {
        expect(given.featureFlags.isFeatureEnabled('beta-feature', { send_event: false })).toEqual(true)
        expect(given.instance.capture).not.toHaveBeenCalled()
    })
})
