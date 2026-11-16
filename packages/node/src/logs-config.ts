import type { PostHogLogsConfig, ResolvedPostHogLogsConfig } from '@posthog/core'

// Server defaults: a process emits far more logs than a browser tab, so the
// rate cap is higher and batches are larger than the mobile / browser values.
export const DEFAULT_FLUSH_INTERVAL_MS = 3000
export const DEFAULT_MAX_BUFFER_SIZE = 100
export const DEFAULT_MAX_BATCH_RECORDS_PER_POST = 100
export const DEFAULT_RATE_CAP_WINDOW_MS = 10000
export const DEFAULT_MAX_LOGS_PER_INTERVAL = 10000
export const DEFAULT_BACKGROUND_FLUSH_BUDGET_MS = 25000
export const DEFAULT_TERMINATION_FLUSH_BUDGET_MS = 2000

export function resolveNodeLogsConfig(
  config: PostHogLogsConfig | undefined,
  inherited: { serviceName?: string; hostResourceAttributes?: Record<string, string> } = {}
): ResolvedPostHogLogsConfig {
  // `rateCap` is dropped so the flat names below are the only authoritative form.
  const { rateCap: _rateCap, ...rest } = config ?? {}
  const rateCapWindowMs = config?.rateCap?.windowMs ?? DEFAULT_RATE_CAP_WINDOW_MS
  const requestedMaxLogs =
    config?.rateCap && 'maxLogs' in config.rateCap ? config.rateCap.maxLogs : DEFAULT_MAX_LOGS_PER_INTERVAL
  // Per the Logs spec, a non-positive `maxLogs` or window disables the cap rather than dropping everything.
  const maxLogsPerInterval =
    requestedMaxLogs !== undefined && requestedMaxLogs > 0 && rateCapWindowMs > 0 ? requestedMaxLogs : undefined
  const maxBatchRecordsPerPost = config?.maxBatchRecordsPerPost
  return {
    ...rest,
    serviceName: config?.serviceName ?? inherited.serviceName,
    maxBufferSize: config?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
    flushIntervalMs: config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    // 0, a fraction or NaN would send empty batches forever, so anything but a positive integer gets the default.
    maxBatchRecordsPerPost:
      Number.isInteger(maxBatchRecordsPerPost) && maxBatchRecordsPerPost! > 0
        ? maxBatchRecordsPerPost!
        : DEFAULT_MAX_BATCH_RECORDS_PER_POST,
    rateCapWindowMs,
    maxLogsPerInterval,
    // A server-side queue holds a whole window's worth while a flush is in flight.
    // With the cap disabled, keep the default window's worth rather than collapsing to one buffer.
    maxQueueSize: maxLogsPerInterval ?? DEFAULT_MAX_LOGS_PER_INTERVAL,
    backgroundFlushBudgetMs: DEFAULT_BACKGROUND_FLUSH_BUDGET_MS,
    terminationFlushBudgetMs: DEFAULT_TERMINATION_FLUSH_BUDGET_MS,
    // User-provided attributes win over host-detected ones.
    resourceAttributes: { ...inherited.hostResourceAttributes, ...config?.resourceAttributes },
  }
}
