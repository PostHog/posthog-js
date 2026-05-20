/**
 * Experimental APIs
 *
 * This module exports experimental features that may change or be removed in minor versions.
 * Use these APIs with caution and be prepared for breaking changes.
 *
 * @packageDocumentation
 * @experimental
 */

import {
  getPostHogNodeExperimentalWarningGlobal,
  POSTHOG_NODE_EXPERIMENTAL_DEPRECATION_WARNING,
  POSTHOG_NODE_EXPERIMENTAL_WARNING_KEY,
} from './experimental-deprecation'
import type {
  FlagDefinitionCacheData as FlagDefinitionCacheDataType,
  FlagDefinitionCacheProvider as FlagDefinitionCacheProviderType,
} from './extensions/feature-flags/cache'

const globalWithPostHogExperimentalWarning = getPostHogNodeExperimentalWarningGlobal()

if (!globalWithPostHogExperimentalWarning[POSTHOG_NODE_EXPERIMENTAL_WARNING_KEY]) {
  globalWithPostHogExperimentalWarning[POSTHOG_NODE_EXPERIMENTAL_WARNING_KEY] = true
  // eslint-disable-next-line no-console
  console.warn(POSTHOG_NODE_EXPERIMENTAL_DEPRECATION_WARNING)
}

/**
 * @deprecated Use `import type { FlagDefinitionCacheData } from 'posthog-node'` instead.
 */
export type FlagDefinitionCacheData = FlagDefinitionCacheDataType

/**
 * Runtime placeholder for backwards-compatible named imports from `posthog-node/experimental`.
 *
 * This intentionally shares a name with the type alias above: the type alias preserves
 * existing TypeScript users, while this value export lets runtime named imports load
 * the module and receive the deprecation warning.
 *
 * @deprecated `FlagDefinitionCacheData` is a type-only API. Use `import type { FlagDefinitionCacheData } from 'posthog-node'` instead.
 */
export const FlagDefinitionCacheData: undefined = undefined

/**
 * @deprecated Use `import type { FlagDefinitionCacheProvider } from 'posthog-node'` instead.
 */
export type FlagDefinitionCacheProvider = FlagDefinitionCacheProviderType

/**
 * Runtime placeholder for backwards-compatible named imports from `posthog-node/experimental`.
 *
 * This intentionally shares a name with the type alias above: the type alias preserves
 * existing TypeScript users, while this value export lets runtime named imports load
 * the module and receive the deprecation warning.
 *
 * @deprecated `FlagDefinitionCacheProvider` is a type-only API. Use `import type { FlagDefinitionCacheProvider } from 'posthog-node'` instead.
 */
export const FlagDefinitionCacheProvider: undefined = undefined
