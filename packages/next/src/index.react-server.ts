// Server component exports (only available in react-server context)
export { PostHogProvider } from './app/PostHogProvider.js'
export type { PostHogProviderProps, BootstrapFlagsConfig } from './app/PostHogProvider.js'

// Client-safe exports (re-exported so server components can also import them)
export { PostHogPageView } from './client/PostHogPageView.js'
export { usePostHog, useFeatureFlag, useActiveFeatureFlags, PostHogFeature } from './client/hooks.js'
