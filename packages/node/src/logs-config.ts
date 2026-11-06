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
  const maxLogsPerInterval =
    config?.rateCap && 'maxLogs' in config.rateCap ? config.rateCap.maxLogs : DEFAULT_MAX_LOGS_PER_INTERVAL
  return {
    ...rest,
    serviceName: config?.serviceName ?? inherited.serviceName,
    maxBufferSize: config?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
    flushIntervalMs: config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    maxBatchRecordsPerPost: config?.maxBatchRecordsPerPost ?? DEFAULT_MAX_BATCH_RECORDS_PER_POST,
    rateCapWindowMs: config?.rateCap?.windowMs ?? DEFAULT_RATE_CAP_WINDOW_MS,
    maxLogsPerInterval,
    // A server-side queue holds a whole window's worth while a flush is in flight.
    maxQueueSize: maxLogsPerInterval,
    backgroundFlushBudgetMs: DEFAULT_BACKGROUND_FLUSH_BUDGET_MS,
    terminationFlushBudgetMs: DEFAULT_TERMINATION_FLUSH_BUDGET_MS,
    // User-provided attributes win over host-detected ones.
    resourceAttributes: { ...inherited.hostResourceAttributes, ...config?.resourceAttributes },
  }
}
