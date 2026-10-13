import type { PostHogFeatureFlags } from './feature-flags'
import type { ExtensionToken } from './token'

/** Resolve the common feature-flags API without importing its implementation. */
export const FeatureFlagsCommonExtension = 'featureFlagsCommon' as ExtensionToken<PostHogFeatureFlags>
