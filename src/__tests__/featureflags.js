import { PostHogFeatureFlags } from '../posthog-featureflags'

describe('featureflags', () => {
    given('properties', () => ({ $override_feature_flags: false, $active_feature_flags: ['beta-feature'] }))

    given('config', () => ({ decide_api_version: 1 }))

    given('instance', () => ({
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        get_property: (key) => given.properties[key],
        capture: () => {},
    }))

    given('featureFlags', () => new PostHogFeatureFlags(given.instance))

    beforeEach(() => {
        jest.spyOn(given.instance, 'capture').mockReturnValue()
    })

    it('should return the right feature flag and call capture', () => {
        expect(given.featureFlags.getFlags()).toEqual(['beta-feature'])
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(given.featureFlags.isFeatureEnabled('random')).toEqual(false)
        expect(given.instance.capture).toHaveBeenCalledTimes(2)

        // It should not call `capture` on subsequent calls
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(given.instance.capture).toHaveBeenCalledTimes(2)
    })

    it('should return the right feature flag and not call capture', () => {
        expect(given.featureFlags.isFeatureEnabled('beta-feature', { send_event: false })).toEqual(true)
        expect(given.instance.capture).not.toHaveBeenCalled()
    })
})

describe('featureflags - with decide v2', () => {
    given('properties', () => ({
        $override_feature_flags: false,
        $active_feature_flags: {
            'beta-feature': true,
            'alpha-feature-2': true,
            'multivariate-flag': 'variant-1',
        },
    }))

    given('config', () => ({ decide_api_version: 2 }))

    given('instance', () => ({
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        get_property: (key) => given.properties[key],
        capture: () => {},
    }))

    given('featureFlags', () => new PostHogFeatureFlags(given.instance))

    beforeEach(() => {
        jest.spyOn(given.instance, 'capture').mockReturnValue()
    })

    it('should return the right feature flag and call capture', () => {
        expect(given.featureFlags.getFlags()).toEqual({
            'alpha-feature-2': true,
            'beta-feature': true,
            'multivariate-flag': 'variant-1',
        })
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(given.featureFlags.isFeatureEnabled('random')).toEqual(false)

        // strict check against true
        expect(given.featureFlags.isFeatureEnabled('multivariate-flag')).toEqual(false)

        expect(given.instance.capture).toHaveBeenCalledTimes(3)

        // It should not call `capture` on subsequent calls
        expect(given.featureFlags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(given.instance.capture).toHaveBeenCalledTimes(3)
    })

    it('should return the right feature flag and not call capture', () => {
        expect(given.featureFlags.isFeatureEnabled('beta-feature', { send_event: false })).toEqual(true)
        expect(given.instance.capture).not.toHaveBeenCalled()
    })
})
