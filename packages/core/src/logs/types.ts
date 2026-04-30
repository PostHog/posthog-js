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
} from '@posthog/types'

/**
 * SDK-internal context the host SDK passes to `buildOtlpLogRecord` at capture
 * time. Each SDK populates the fields that apply to it: browser fills
 * `currentUrl`, mobile fills `screenName` / `appState`. Missing fields are
 * omitted from the OTLP record (no stray attributes).
 *
 * Internal to `@posthog/core` — customers don't see this in autocomplete.
 */
export interface LogSdkContext {
  distinctId?: string
  sessionId?: string
  /** Web-only — current page URL */
  currentUrl?: string
  /** Mobile-only — current screen / view name */
  screenName?: string
  /** Mobile-only — app foreground/background state at capture time */
  appState?: 'foreground' | 'background'
  activeFeatureFlags?: string[]
}

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
  maxBufferSize?: number
  maxBatchRecordsPerPost?: number // keeps each POST under the 2 MB server cap

  /**
   * Tumbling-window rate cap. Both fields default per-SDK; pass either to
   * tune. `maxLogs` undefined means unbounded.
   */
  rateCap?: {
    maxLogs?: number
    windowMs?: number
  }

  // Filtering. Runs synchronously before the rate cap so beforeSend-dropped
  // records do not consume the per-interval budget. Accepts a single fn or
  // an array (chain). Throwing fns are logged and skipped — they must never
  // crash the caller's `captureLog()`.
  beforeSend?: BeforeSendLogFn | BeforeSendLogFn[]
}

// Fields PostHogLogs needs resolved at runtime. The host SDK fills in its
// defaults and hands the resolved config to the PostHogLogs constructor.
// Flat names internally — public API uses `rateCap: { maxLogs, windowMs }`.
export interface ResolvedPostHogLogsConfig extends Omit<PostHogLogsConfig, 'rateCap'> {
  maxBufferSize: number
  flushIntervalMs: number
  maxBatchRecordsPerPost: number
  rateCapWindowMs: number
  maxLogsPerInterval?: number
  backgroundFlushBudgetMs: number
  terminationFlushBudgetMs: number
}
