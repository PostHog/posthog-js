import { createPostHog, FeatureFlagsExtension } from '@posthog/browser/core'

void import('@posthog/browser/flags').then(async ({ featureFlags }) => {
    const posthog = await createPostHog({ projectToken: 'ph_test', extensions: [featureFlags()] })
    const extension = await posthog.resolveExtension(FeatureFlagsExtension)
    extension?.getFeatureFlag('test')
})
