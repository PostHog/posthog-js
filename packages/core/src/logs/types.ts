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

export interface BufferedLogEntry {
  record: OtlpLogRecord
}

/**
 * `beforeSend` hook signature. Return the (possibly transformed) record to
 * keep it, or `null` to drop it. Configure as a single function or an array
 * (chain of filters, evaluated left-to-right).
 */
export type BeforeSendLogFn = (record: CaptureLogOptions) => CaptureLogOptions | null

// Public configuration for the logs module.
export interface PostHogLogsConfig {
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
  // records do not consume the per-interval budget. Accepts a single fn or
  // an array (chain). Throwing fns are logged and skipped — they must never
  // crash the caller's `captureLog()`.
  beforeSend?: BeforeSendLogFn | BeforeSendLogFn[]
}

// Fields PostHogLogs needs resolved at runtime. The host SDK fills in its
// defaults and hands the resolved config to the PostHogLogs constructor.
//
// `rateCapWindowMs` is always resolved so the rate-cap arithmetic doesn't
// branch at the hot path. `maxLogsPerInterval` stays optional — `undefined`
// means unbounded.
export interface ResolvedPostHogLogsConfig extends PostHogLogsConfig {
  maxBufferSize: number
  flushIntervalMs: number
  maxBatchRecordsPerPost: number
  rateCapWindowMs: number
  backgroundFlushBudgetMs: number
  terminationFlushBudgetMs: number
}
