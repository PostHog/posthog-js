// Browser-safe exports. PostHogProvider (a server component) is excluded
// because it imports posthog-node which uses Node.js APIs.
export { PostHogPageView } from './client/PostHogPageView'
export { DEFAULT_INGEST_PATH } from './shared/constants'
export { usePostHog, useFeatureFlag, useActiveFeatureFlags, PostHogFeature } from './client/hooks'

// Re-export types (type-only, erased at build time)
export type { PostHogProviderProps, BootstrapFlagsConfig } from './app/PostHogProvider'
export type { PostHogMiddlewareOptions, PostHogProxyOptions } from './middleware/postHogMiddleware'
