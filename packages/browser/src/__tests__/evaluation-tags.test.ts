import { MutableFeatureFlagsConfigSource } from '../feature-flags-config'
import { defaultConfig } from '../posthog-core'

describe('feature flag evaluation contexts', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        delete (window as Window & { POSTHOG_DEBUG?: boolean }).POSTHOG_DEBUG
    })

    it('maps deprecated evaluation environments and warns once', () => {
        const config = defaultConfig()
        config.evaluation_environments = ['legacy']
        ;(window as Window & { POSTHOG_DEBUG?: boolean }).POSTHOG_DEBUG = true
        const warn = vi.spyOn(window.console, 'warn').mockImplementation(() => {})
        const source = new MutableFeatureFlagsConfigSource(config)

        source.update(config, false)

        expect(source.get().evaluationContexts).toEqual(['legacy'])
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            expect.stringContaining('evaluation_environments is deprecated')
        )
    })

    it('scopes invalid flag key configuration errors to feature flags', () => {
        ;(window as Window & { POSTHOG_DEBUG?: boolean }).POSTHOG_DEBUG = true
        const config = defaultConfig()
        config.flag_keys = 'invalid' as unknown as string[]
        const error = vi.spyOn(window.console, 'error').mockImplementation(() => {})

        new MutableFeatureFlagsConfigSource(config)

        expect(error).toHaveBeenCalledWith(
            '[PostHog.js] [FeatureFlags]',
            'Invalid flag_keys found:',
            'invalid',
            'Expected array of non-empty strings'
        )
    })
})
