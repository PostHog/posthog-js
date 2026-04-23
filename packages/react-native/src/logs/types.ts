// Re-export OTLP/log types from @posthog/types so the rest of the logs module can
// pull everything from one place.
export type {
  LogSeverityLevel,
  OtlpSeverityText,
  OtlpSeverityEntry,
  LogAttributeValue,
  LogAttributes,
  CaptureLogOptions,
  OtlpAnyValue,
  OtlpKeyValue,
  OtlpLogRecord,
  OtlpLogsPayload,
  LogSdkContext,
} from '@posthog/types'

// The public capture-logger interface lives in @posthog/types as `Logger`. Core
// also exports a `Logger` (the SDK's internal warn/info/error logger). Alias the
// public one to avoid the name collision inside this package.
import type { Logger as CaptureLoggerType } from '@posthog/types'
export type CaptureLogger = CaptureLoggerType

import type { LogAttributeValue, CaptureLogOptions, OtlpLogRecord } from '@posthog/types'

// Wrapper around OtlpLogRecord for queue entries. Parallels events' queue
// item shape (`{ message }`) — future additions like `retryCount` or
// `enqueuedAt` can be added without migrating the queue format.
export interface BufferedLogEntry {
  record: OtlpLogRecord
}

// Public configuration for the logs module. Mobile defaults diverge from
// browser where cellular radio cost or platform constraints apply.
export interface PostHogLogsConfig {
  // Master switch. Default: true when a config object is provided.
  enabled?: boolean

  // Resource attributes
  serviceName?: string
  serviceVersion?: string
  environment?: string
  resourceAttributes?: Record<string, LogAttributeValue>

  // Buffering
  flushIntervalMs?: number // default: 10000 (browser uses 3000; cellular radio tail)
  rateCapWindowMs?: number // default: 10000, separate from flushIntervalMs so flush cadence does not move the rate-cap window
  maxBufferSize?: number // default: 100 — RN's in-memory buffer
  maxLogsPerInterval?: number // default: 500 (browser uses 1000; cellular data cost)
  maxBatchRecordsPerPost?: number // default: 50 — keeps each POST under the 2 MB server cap

  // Shutdown — separate budgets because foreground→background and app-terminate
  // have different OS-imposed windows.
  backgroundFlushBudgetMs?: number // default: 25000 (under iOS beginBackgroundTask ~30s)
  terminationFlushBudgetMs?: number // default: 2000 (reset / app-terminate path)

  // Filtering. Runs synchronously before the rate cap so beforeSend-dropped
  // records do not consume the per-interval budget.
  beforeSend?: (record: CaptureLogOptions) => CaptureLogOptions | null
}

// Mobile defaults
export const DEFAULT_FLUSH_INTERVAL_MS = 10000
export const DEFAULT_RATE_CAP_WINDOW_MS = 10000
export const DEFAULT_MAX_BUFFER_SIZE = 100
export const DEFAULT_MAX_LOGS_PER_INTERVAL = 500
export const DEFAULT_MAX_BATCH_RECORDS_PER_POST = 50
export const DEFAULT_BACKGROUND_FLUSH_BUDGET_MS = 25000
export const DEFAULT_TERMINATION_FLUSH_BUDGET_MS = 2000
