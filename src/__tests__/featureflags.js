import { PostHogFeatureFlags } from '../posthog-featureflags'

fdescribe('featureflags', () => {
    given('instance', () => ({
        get_property: (key) => {
            if (key === '$override_feature_flags') return false
            if (key === '$active_feature_flags') return ['beta-feature']
        },
        capture: () => {},
    }))
    given('feature_flags', () => new PostHogFeatureFlags(given.instance))

    beforeEach(() => {
        jest.spyOn(given.instance, 'capture').mockReturnValue()
    })

    it('should return the right feature flag and call capture', () => {
        expect(given.feature_flags.getFlags()).toEqual(['beta-feature'])
        expect(given.feature_flags.isFeatureEnabled('beta-feature')).toEqual(true)
        expect(given.feature_flags.isFeatureEnabled('random')).toEqual(false)
        expect(given.instance.capture).toHaveBeenCalled()
    })

    it('should return the right feature flag and not call capture', () => {
        expect(given.feature_flags.isFeatureEnabled('beta-feature', false)).toEqual(true)
        expect(given.instance.capture).not.toHaveBeenCalled()
    })
})
