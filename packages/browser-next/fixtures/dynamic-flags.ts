import { createPostHog, FeatureFlagsExtension } from '@posthog/browser/core'

void import('@posthog/browser/flags').then(async ({ flags }) => {
    const posthog = await createPostHog({ projectToken: 'ph_test', extensions: [flags()] })
    const featureFlags = await posthog.resolveExtension(FeatureFlagsExtension)
    featureFlags?.getFeatureFlag('test')
})
