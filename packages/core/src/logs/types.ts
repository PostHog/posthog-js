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

// Public configuration for the logs module. Per-SDK defaults diverge (mobile
// cellular radio cost, browser tab suspension, node process lifecycle).
export interface PostHogLogsConfig {
  // Master switch. Default: true when a config object is provided.
  enabled?: boolean

  // Resource attributes
  serviceName?: string
  serviceVersion?: string
  environment?: string
  resourceAttributes?: Record<string, LogAttributeValue>

  // Buffering
  flushIntervalMs?: number
  rateCapWindowMs?: number // separate from flushIntervalMs so flush cadence does not move the rate-cap window
  maxBufferSize?: number
  maxLogsPerInterval?: number
  maxBatchRecordsPerPost?: number // keeps each POST under the 2 MB server cap

  // Shutdown — separate budgets because foreground→background and app-terminate
  // have different OS-imposed windows.
  backgroundFlushBudgetMs?: number
  terminationFlushBudgetMs?: number

  // Filtering. Runs synchronously before the rate cap so beforeSend-dropped
  // records do not consume the per-interval budget.
  beforeSend?: (record: CaptureLogOptions) => CaptureLogOptions | null
}

// Fields PostHogLogs needs resolved at runtime. Each SDK supplies its own
// defaults (mobile, browser, node have different right answers) and hands the
// filled-in config to the PostHogLogs constructor.
export interface ResolvedPostHogLogsConfig extends PostHogLogsConfig {
  maxBufferSize: number
}
