// Edge-runtime exports (middleware). Excludes PostHogProvider and
// posthog-node which require Node.js APIs.
export { postHogMiddleware } from './middleware/postHogMiddleware.js'
export { PostHogPageView } from './client/PostHogPageView.js'
export { DEFAULT_INGEST_PATH } from './shared/constants.js'
export { usePostHog, useFeatureFlag, useActiveFeatureFlags, PostHogFeature } from './client/hooks.js'

// Re-export types (type-only, erased at build time)
export type { PostHogProviderProps, BootstrapFlagsConfig } from './app/PostHogProvider.js'
export type { PostHogMiddlewareOptions, PostHogProxyOptions } from './middleware/postHogMiddleware.js'
