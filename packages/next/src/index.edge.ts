// Edge-runtime exports (middleware). Excludes PostHogProvider and
// posthog-node which require Node.js APIs.
export { postHogMiddleware } from './middleware/postHogMiddleware'
export { PostHogPageView } from './client/PostHogPageView'
export { DEFAULT_INGEST_PATH } from './shared/constants'
export { usePostHog, useFeatureFlag, useActiveFeatureFlags, PostHogFeature } from './client/hooks'

// Re-export types (type-only, erased at build time)
export type { PostHogProviderProps, BootstrapFlagsConfig } from './app/PostHogProvider'
export type { PostHogMiddlewareOptions, PostHogProxyOptions } from './middleware/postHogMiddleware'
