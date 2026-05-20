export const POSTHOG_NODE_EXPERIMENTAL_WARNING_KEY = '__posthogNodeExperimentalImportWarningShown'

export const POSTHOG_NODE_EXPERIMENTAL_DEPRECATION_WARNING =
  "[PostHog] `posthog-node/experimental` is deprecated. Use `import type { FlagDefinitionCacheData, FlagDefinitionCacheProvider } from 'posthog-node'` instead."

type PostHogNodeExperimentalWarningGlobal = typeof globalThis &
  Partial<Record<typeof POSTHOG_NODE_EXPERIMENTAL_WARNING_KEY, boolean>>

export const getPostHogNodeExperimentalWarningGlobal = (): PostHogNodeExperimentalWarningGlobal =>
  globalThis as PostHogNodeExperimentalWarningGlobal
