import { createPostHog, FeatureFlagsExtension } from '@posthog/browser/core'
import { flags } from '@posthog/browser/flags'

void createPostHog({ projectToken: 'ph_test', extensions: [flags()] }).then((posthog) =>
    posthog.getExtension(FeatureFlagsExtension)?.getFeatureFlag('test')
)
