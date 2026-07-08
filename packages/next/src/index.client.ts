// Browser-safe exports. PostHogProvider (a server component) is excluded
// because it imports posthog-node which uses Node.js APIs.
export { PostHogPageView } from './client/PostHogPageView.js'
export { DEFAULT_INGEST_PATH } from './shared/constants.js'
export { usePostHog, useFeatureFlag, useActiveFeatureFlags, PostHogFeature } from './client/hooks.js'

// Re-export types (type-only, erased at build time)
export type { PostHogProviderProps, BootstrapFlagsConfig } from './app/PostHogProvider.js'
export type { PostHogMiddlewareOptions, PostHogProxyOptions } from './middleware/postHogMiddleware.js'
