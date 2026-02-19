// Client-side exports
export { PostHogProvider } from './app/PostHogProvider'
export type { PostHogProviderProps, BootstrapFlagsConfig } from './app/PostHogProvider'
export { PostHogPageView } from './client/PostHogPageView'

// Re-export hooks from posthog-js/react
export {
    usePostHog,
    useFeatureFlagResult as useFeatureFlag,
    useActiveFeatureFlags,
    PostHogFeature,
} from 'posthog-js/react'
