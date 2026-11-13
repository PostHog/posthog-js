import type { IFeatureFlagsCommon } from './feature-flags-types'
import type { ExtensionToken } from './token'

/** Resolve the common feature-flags API without importing its implementation. */
export const FeatureFlagsCommonExtension = 'featureFlagsCommon' as ExtensionToken<IFeatureFlagsCommon>
