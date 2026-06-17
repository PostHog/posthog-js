import type { LogCaptureOptions } from '@posthog/types'
import type { ResolvedPostHogLogsConfig } from '@posthog/core'

// Browser defaults. Faster flush than mobile since a tab can be suspended anytime.
const DEFAULT_FLUSH_INTERVAL_MS = 3000
// Flush trigger — drain proactively once this many records are buffered.
const DEFAULT_MAX_BUFFER_SIZE = 100
const DEFAULT_MAX_LOGS_PER_INTERVAL = 1000
// Bounds each POST independently of the buffer so a full buffer drains as ~10 requests.
const DEFAULT_MAX_BATCH_RECORDS_PER_POST = 100

/**
 * Translates the flat public `logs` config into the resolved shape the core
 * `PostHogLogs` consumes, applying browser defaults.
 */
export function resolveLogsConfig(config: LogCaptureOptions | undefined): ResolvedPostHogLogsConfig {
    const flushIntervalMs = config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
    const maxBufferSize = config?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE
    const maxLogsPerInterval = config?.maxLogsPerInterval ?? DEFAULT_MAX_LOGS_PER_INTERVAL
    // Eviction cap at the rate cap (or buffer, if larger): hold everything the cap
    // admits before dropping oldest; flushing still triggers at `maxBufferSize`.
    const maxQueueSize = Math.max(maxBufferSize, maxLogsPerInterval)
    // Hoist OTLP keys from `resourceAttributes` into the named fields so they keep
    // their precedence through the core merge. No `service.name` default: core fills
    // `unknown_service` when unset, preserving the programmatic path's prior default.
    const resourceAttributes = config?.resourceAttributes
    return {
        serviceName: (resourceAttributes?.['service.name'] as string | undefined) ?? config?.serviceName,
        serviceVersion: (resourceAttributes?.['service.version'] as string | undefined) ?? config?.serviceVersion,
        environment: (resourceAttributes?.['deployment.environment'] as string | undefined) ?? config?.environment,
        resourceAttributes,
        beforeSend: config?.beforeSend,
        flushIntervalMs,
        maxBufferSize,
        maxQueueSize,
        maxBatchRecordsPerPost: DEFAULT_MAX_BATCH_RECORDS_PER_POST,
        // Rate-cap window tracks the flush interval: the browser exposes a single
        // cadence knob and has no separate window setting.
        rateCapWindowMs: flushIntervalMs,
        maxLogsPerInterval,
        // Mobile-only budgets; the browser drains on pagehide via sendBeacon.
        backgroundFlushBudgetMs: 0,
        terminationFlushBudgetMs: 0,
    }
}
