import { createPostHog, FeatureFlagsExtension } from '@posthog/browser/core'
import { featureFlags } from '@posthog/browser/flags'

void createPostHog({ projectToken: 'ph_test', extensions: [featureFlags()] }).then(async (posthog) => {
    const featureFlags = await posthog.resolveExtension(FeatureFlagsExtension)
    featureFlags?.getFeatureFlag('test')
})
