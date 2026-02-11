import { PostHog } from './posthog-rn'

export default PostHog
export * from './posthog-rn'
export * from './hooks/useNavigationTracker'
export * from './hooks/useFeatureFlags'
export * from './hooks/useFeatureFlag'
export * from './hooks/usePostHog'
export * from './PostHogMaskView'
export * from './PostHogProvider'
export {
  PostHogErrorBoundary,
  PostHogErrorBoundaryProps,
  PostHogErrorBoundaryFallbackProps,
} from './PostHogErrorBoundary'
export * from './types'
export * from './surveys'
