/**
 * Experimental APIs
 *
 * This module exports experimental features that may change or be removed in minor versions.
 * Use these APIs with caution and be prepared for breaking changes.
 *
 * @packageDocumentation
 * @experimental
 */

import type {
  FlagDefinitionCacheData as FlagDefinitionCacheDataType,
  FlagDefinitionCacheProvider as FlagDefinitionCacheProviderType,
} from './extensions/feature-flags/cache'

const globalWithPostHogExperimentalWarning = globalThis as typeof globalThis & {
  __posthogNodeExperimentalImportWarningShown?: boolean
}

if (!globalWithPostHogExperimentalWarning.__posthogNodeExperimentalImportWarningShown) {
  globalWithPostHogExperimentalWarning.__posthogNodeExperimentalImportWarningShown = true
  // eslint-disable-next-line no-console
  console.warn(
    "[PostHog] `posthog-node/experimental` is deprecated. Use `import type { FlagDefinitionCacheData, FlagDefinitionCacheProvider } from 'posthog-node'` instead."
  )
}

/**
 * @deprecated Use `import type { FlagDefinitionCacheData } from 'posthog-node'` instead.
 */
export type FlagDefinitionCacheData = FlagDefinitionCacheDataType

/**
 * Runtime placeholder for backwards-compatible named imports from `posthog-node/experimental`.
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
 * @deprecated `FlagDefinitionCacheProvider` is a type-only API. Use `import type { FlagDefinitionCacheProvider } from 'posthog-node'` instead.
 */
export const FlagDefinitionCacheProvider: undefined = undefined
