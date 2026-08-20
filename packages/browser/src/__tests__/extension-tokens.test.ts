import type { ExtensionToken } from '@posthog/browser-common'

import type { Autocapture } from '../autocapture'
import type { PostHogFeatureFlags } from '../posthog-featureflags'
import type { PostHogSurveys } from '../posthog-surveys'
import { AutocaptureExtension, FeatureFlagsExtension, SurveysExtension } from '../extension-tokens'

describe('browser extension tokens', () => {
    it('exports typed stable names for built-in shared extensions', () => {
        const autocapture: ExtensionToken<Autocapture> = AutocaptureExtension
        const featureFlags: ExtensionToken<PostHogFeatureFlags> = FeatureFlagsExtension
        const surveys: ExtensionToken<PostHogSurveys> = SurveysExtension

        expect(autocapture).toBe('autocapture')
        expect(featureFlags).toBe('featureFlags')
        expect(surveys).toBe('surveys')
    })
})
