import { Platform } from 'react-native'
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

/**
 * RN-specific resource attribute defaults. Identifies the device's OS so
 * logs can be filtered by platform (e.g. "all errors on Android 13" or
 * "iOS 17 only" in the PostHog UI). User-supplied `resourceAttributes`
 * spreads last in `_buildResourceAttributes` so these are overridable.
 *
 * `Platform.Version` is `string` on iOS and `number` on Android — coerce
 * to string so the OTLP `os.version` attribute has a stable type.
 */
function defaultResourceAttributes(): Record<string, string> {
  return {
    'os.name': Platform.OS,
    'os.version': String(Platform.Version),
  }
}

export function resolveLogsConfig(config: PostHogLogsConfig | undefined): ResolvedPostHogLogsConfig {
  return {
    ...config,
    maxBufferSize: config?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
    flushIntervalMs: config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    maxBatchRecordsPerPost: config?.maxBatchRecordsPerPost ?? DEFAULT_MAX_BATCH_RECORDS_PER_POST,
    // Rate-cap window defaults independently of flush cadence: changing flush
    // frequency shouldn't implicitly re-shape the rate budget.
    rateCapWindowMs: config?.rateCapWindowMs ?? DEFAULT_RATE_CAP_WINDOW_MS,
    // `maxLogsPerInterval` stays optional in the resolved config. RN defaults
    // to 500/window to bound cellular data cost; pass `maxLogsPerInterval:
    // undefined` in user config to opt out.
    maxLogsPerInterval: config?.maxLogsPerInterval ?? DEFAULT_MAX_LOGS_PER_INTERVAL,
    backgroundFlushBudgetMs: config?.backgroundFlushBudgetMs ?? DEFAULT_BACKGROUND_FLUSH_BUDGET_MS,
    terminationFlushBudgetMs: config?.terminationFlushBudgetMs ?? DEFAULT_TERMINATION_FLUSH_BUDGET_MS,
    // Merge platform-detected attrs first so user-provided `resourceAttributes`
    // wins on any conflict. Never throw if `Platform` is unavailable in
    // unusual envs (web bundle, jest without RN preset) — fall back silently.
    resourceAttributes: {
      ...defaultResourceAttributes(),
      ...config?.resourceAttributes,
    },
  }
}
