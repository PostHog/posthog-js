import type { LogCaptureOptions } from '@posthog/types'
import type { ResolvedPostHogLogsConfig } from '@posthog/core'
import { isUndefined } from '@posthog/core'

// Browser defaults. Faster flush than mobile since a tab can be suspended anytime.
const DEFAULT_FLUSH_INTERVAL_MS = 3000
// Flush trigger — drain proactively once this many records are buffered.
const DEFAULT_MAX_BUFFER_SIZE = 100
const DEFAULT_MAX_LOGS_PER_INTERVAL = 1000
// Eviction backstop for the console instance, which runs with no per-interval rate
// cap (see `consoleCapture` below) — so this depth is its ONLY drop protection.
// 2048 is deep enough to hold a console burst across flush cycles rather than
// dropping it.
const DEFAULT_CONSOLE_MAX_QUEUE_SIZE = 2048
// Bounds each POST independently of the buffer so a full buffer drains as ~10 requests.
const DEFAULT_MAX_BATCH_RECORDS_PER_POST = 100

/**
 * Translates the flat public `logs` config into the resolved shape the core
 * `PostHogLogs` consumes, applying browser defaults.
 *
 * `serviceNameDefault` lets the console-capture instance fall back to
 * `posthog-browser-logs` when the user hasn't set `serviceName`, while the
 * programmatic instance falls back to core's `unknown_service`. A user-set
 * `serviceName` wins for both.
 *
 * `consoleCapture` runs the instance with no per-interval rate cap and a deep
 * buffer that drops oldest only at saturation (used for console auto-capture).
 * It forces the rate cap off even when the user sets `maxLogsPerInterval`, so
 * console capture is never rate-limited; the deep buffer is the only backstop.
 */
export function resolveLogsConfig(
    config: LogCaptureOptions | undefined,
    opts?: { serviceNameDefault?: string; consoleCapture?: boolean }
): ResolvedPostHogLogsConfig {
    const flushIntervalMs = config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
    const maxBufferSize = config?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE
    // Console capture (consoleCapture) is always unbounded — a user-set value is
    // ignored so console capture is never rate-limited. Programmatic honors the
    // user value or defaults to 1000/interval. `undefined` means no rate cap in core.
    const maxLogsPerInterval = opts?.consoleCapture
        ? undefined
        : (config?.maxLogsPerInterval ?? DEFAULT_MAX_LOGS_PER_INTERVAL)
    // Eviction cap: hold everything the rate cap admits before dropping oldest
    // (flushing still triggers at `maxBufferSize`). When uncapped, fall back to the
    // deep buffer depth so a burst is retained rather than dropped.
    const maxQueueSize = isUndefined(maxLogsPerInterval)
        ? Math.max(maxBufferSize, DEFAULT_CONSOLE_MAX_QUEUE_SIZE)
        : Math.max(maxBufferSize, maxLogsPerInterval)
    // Hoist OTLP keys from `resourceAttributes` into the named fields so they keep
    // their precedence through the core merge. The programmatic path passes no
    // `serviceNameDefault`, so core fills `unknown_service` when unset.
    const resourceAttributes = config?.resourceAttributes
    return {
        serviceName:
            (resourceAttributes?.['service.name'] as string | undefined) ??
            config?.serviceName ??
            opts?.serviceNameDefault,
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
