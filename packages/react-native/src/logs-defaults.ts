import type { PostHogLogsConfig, ResolvedPostHogLogsConfig } from '@posthog/core'

// Mobile defaults. Tuned for cellular radio tail (longer flush interval keeps
// the radio asleep) and cellular data cost (tighter per-interval rate cap).
export const DEFAULT_FLUSH_INTERVAL_MS = 10000
export const DEFAULT_RATE_CAP_WINDOW_MS = 10000
export const DEFAULT_MAX_BUFFER_SIZE = 100
export const DEFAULT_MAX_LOGS_PER_INTERVAL = 500
export const DEFAULT_MAX_BATCH_RECORDS_PER_POST = 50
// iOS beginBackgroundTask budget is ~30s; stay comfortably under.
export const DEFAULT_BACKGROUND_FLUSH_BUDGET_MS = 25000
export const DEFAULT_TERMINATION_FLUSH_BUDGET_MS = 2000

export function resolveLogsConfig(config: PostHogLogsConfig | undefined): ResolvedPostHogLogsConfig {
  return {
    ...config,
    maxBufferSize: config?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
  }
}
