import { PostHogLib } from '../posthog-core'
import { PostHogFeatureFlags } from '../posthog-featureflags'

describe('featureflags', () => {
    given('properties', () => ({ $override_feature_flags: false, $active_feature_flags: ['beta-feature'] }))

    given('instance', () => ({
        get_property: (key) => given.properties[key],
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
        expect(given.feature_flags.isFeatureEnabled('beta-feature', { send_event: false })).toEqual(true)
        expect(given.instance.capture).not.toHaveBeenCalled()
    })

    it('should fail gracefully if instance not yet initialised', () => {
        const ff = new PostHogLib()
        ff.onFeatureFlags(() => {})
    })
})
