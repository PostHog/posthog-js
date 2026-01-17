export * from './extensions/sentry-integration'
export * from './extensions/express'
export * from './types'

// Re-export FeatureFlagError from core for backwards compatibility.
// These were originally defined in posthog-node and moved to core for reuse across SDKs.
export { FeatureFlagError } from '@posthog/core'
export type { FeatureFlagErrorType } from '@posthog/core'
