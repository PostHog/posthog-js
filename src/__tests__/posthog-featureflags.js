import { PostHogFeatureFlags } from '../posthog-featureflags'
import { init_as_module } from '../posthog-core'

describe(`posthog-featureflags.js`, () => {
    it('should return the value of flags', () => {})

    it('should throw an error when no flags were yet loaded', () => {
        // const posthog = init_as_module()
        // posthog.init('RANDOM_TOKEN')
        // const isEnabled = posthog.isFeatureEnabled('bla')
        // console.log(isEnabled)
    })

    it('should not throw an error when empty flags were loaded', () => {})

    it('should call the callback after the flags were loaded', () => {})

    it('override works', () => {})
})
