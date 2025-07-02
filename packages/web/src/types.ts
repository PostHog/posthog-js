import type { PostHogCoreOptions } from 'posthog-core'

export type PostHogOptions = {
  autocapture?: boolean
  persistence?: 'localStorage' | 'sessionStorage' | 'cookie' | 'memory'
  persistence_name?: string
  captureHistoryEvents?: boolean
} & PostHogCoreOptions
