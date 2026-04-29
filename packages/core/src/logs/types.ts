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

/**
 * `beforeSend` hook signature. Matches the events pipeline's `BeforeSendFn`
 * shape so users get a consistent mental model: return the (possibly
 * transformed) record to keep it, or `null` to drop it. Configure as a single
 * function or an array (chain of filters, evaluated left-to-right).
 */
export type BeforeSendLogFn = (record: CaptureLogOptions) => CaptureLogOptions | null

// Public configuration for the logs module. Per-SDK defaults diverge (mobile
// cellular radio cost, browser tab suspension, node process lifecycle).
//
// Manual capture (`captureLog`, `logger.*`) has no local opt-in — calling the
// API ships records, matching the browser SDK's manual path. The host SDK can
// still wire a server-side kill switch via `PostHogLogs.setRemoteEnabled` if
// it wants the server to be able to remotely block capture (RN does this by
// reading `response.logs.captureConsoleLogs: false`).
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
  // an array (chain); mirrors the events-pipeline `before_send` contract on
  // `PostHogCoreOptions`. Throwing fns are logged and skipped — they must
  // never crash the caller's `captureLog()`.
  beforeSend?: BeforeSendLogFn | BeforeSendLogFn[]
}

// Fields PostHogLogs needs resolved at runtime. Each SDK supplies its own
// defaults (mobile, browser, node have different right answers) and hands the
// filled-in config to the PostHogLogs constructor.
//
// `rateCapWindowMs` is always resolved (falls back to `flushIntervalMs` if
// unset) so the rate-cap arithmetic doesn't branch at the hot path. The cap
// itself (`maxLogsPerInterval`) stays optional — `undefined` means unbounded,
// which is the right default for node-style SDKs where bandwidth isn't the
// concern.
export interface ResolvedPostHogLogsConfig extends PostHogLogsConfig {
  maxBufferSize: number
  flushIntervalMs: number
  maxBatchRecordsPerPost: number
  rateCapWindowMs: number
  backgroundFlushBudgetMs: number
  terminationFlushBudgetMs: number
}
