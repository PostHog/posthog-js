import type { LogCaptureOptions } from '@posthog/types'
import type { ResolvedPostHogLogsConfig } from '@posthog/core'
import { isUndefined } from '@posthog/core'

const DEFAULT_FLUSH_INTERVAL_MS = 3000
const DEFAULT_MAX_BUFFER_SIZE = 100
const DEFAULT_MAX_LOGS_PER_INTERVAL = 1000
// Console runs uncapped, so this buffer depth is its only drop protection.
const DEFAULT_CONSOLE_MAX_QUEUE_SIZE = 2048
const DEFAULT_MAX_BATCH_RECORDS_PER_POST = 100

/**
 * Resolves the public `logs` config into the shape core `PostHogLogs` consumes.
 *
 * `serviceNameDefault` is the console instance's `service.name` fallback
 * (`posthog-browser-logs`); the programmatic instance falls back to core's
 * `unknown_service`. `consoleCapture` disables the per-interval rate cap entirely
 * (even when the user set `maxLogsPerInterval`), so console capture is never
 * rate-dropped — the deep buffer is its only bound.
 */
export function resolveLogsConfig(
    config: LogCaptureOptions | undefined,
    opts?: { serviceNameDefault?: string; consoleCapture?: boolean }
): ResolvedPostHogLogsConfig {
    const flushIntervalMs = config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
    const maxBufferSize = config?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE
    const maxLogsPerInterval = opts?.consoleCapture
        ? undefined
        : (config?.maxLogsPerInterval ?? DEFAULT_MAX_LOGS_PER_INTERVAL)
    const maxQueueSize = isUndefined(maxLogsPerInterval)
        ? Math.max(maxBufferSize, DEFAULT_CONSOLE_MAX_QUEUE_SIZE)
        : Math.max(maxBufferSize, maxLogsPerInterval)
    // OTLP keys in `resourceAttributes` take precedence over the named config fields.
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
        rateCapWindowMs: flushIntervalMs,
        maxLogsPerInterval,
        // Mobile-only budgets; the browser drains on pagehide via sendBeacon.
        backgroundFlushBudgetMs: 0,
        terminationFlushBudgetMs: 0,
    }
}
