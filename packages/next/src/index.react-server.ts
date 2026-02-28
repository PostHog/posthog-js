// Server component exports (only available in react-server context)
export { PostHogProvider } from './app/PostHogProvider'
export type { PostHogProviderProps, BootstrapFlagsConfig } from './app/PostHogProvider'

// Client-safe exports (re-exported so server components can also import them)
export { PostHogPageView } from './client/PostHogPageView'
export { usePostHog, useFeatureFlag, useActiveFeatureFlags, PostHogFeature } from './client/hooks'
