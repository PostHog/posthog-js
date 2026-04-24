import { PostHog } from './posthog-rn'

export default PostHog
export * from './posthog-rn'
export * from './hooks/useNavigationTracker'
export * from './hooks/useFeatureFlags'
export * from './hooks/useFeatureFlag'
export * from './hooks/useFeatureFlagResult'
export * from './hooks/usePostHog'
export * from './PostHogMaskView'
export * from './PostHogProvider'
export * from './PostHogErrorBoundary'
export * from './types'
export * from './surveys'

// Re-export logs public types so consumers can type their own wrappers
// (e.g. hooks, HOCs, custom loggers) without pulling in @posthog/core.
export type {
  BeforeSendLogFn,
  CaptureLogOptions,
  CaptureLogger,
  LogAttributes,
  LogAttributeValue,
  LogSeverityLevel,
  PostHogLogsConfig,
} from '@posthog/core'
