// Client-safe exports only. PostHogProvider (a server component) is
// exported from index.react-server.ts via the "react-server" condition
// in package.json, so it's only available in server component contexts.
export { PostHogPageView } from './client/PostHogPageView'
export { usePostHog, useFeatureFlag, useActiveFeatureFlags, PostHogFeature } from './client/hooks'

// Re-export types (type-only, erased at build time)
export type { PostHogProviderProps, BootstrapFlagsConfig } from './app/PostHogProvider'
