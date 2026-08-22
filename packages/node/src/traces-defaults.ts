import type { ResolvedTracesConfig, TracesConfig } from '@posthog/core'

// OpenTelemetry's BatchSpanProcessor defaults, which the tracing ecosystem has
// converged on and which sit comfortably under the server's 2 MB body cap:
// a full 512-span batch of typical server spans gzips to well under it.
const DEFAULT_FLUSH_INTERVAL_MS = 5000
const DEFAULT_MAX_EXPORT_BATCH_SIZE = 512
const DEFAULT_MAX_QUEUE_SIZE = 2048

/**
 * Coerces a caller-supplied positive-integer option, falling back to the default
 * for anything unusable. `0`, a negative, or `NaN` reaching the export loop
 * would make it unable to make progress.
 */
function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

/**
 * Resolves the public `traces` config into the shape core `PostHogTraces` consumes.
 *
 * OTLP resource attributes take precedence over the named fields, matching how
 * the logs config resolves — a user who sets `service.name` directly means it.
 */
export function resolveTracesConfig(config: TracesConfig | undefined): ResolvedTracesConfig {
  const resourceAttributes = config?.resourceAttributes
  const maxExportBatchSize = positiveInteger(config?.maxExportBatchSize, DEFAULT_MAX_EXPORT_BATCH_SIZE)
  return {
    serviceName: (resourceAttributes?.['service.name'] as string | undefined) ?? config?.serviceName,
    serviceVersion: (resourceAttributes?.['service.version'] as string | undefined) ?? config?.serviceVersion,
    environment: (resourceAttributes?.['deployment.environment'] as string | undefined) ?? config?.environment,
    resourceAttributes,
    flushIntervalMs: positiveInteger(config?.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS),
    maxExportBatchSize,
    // Never below the flush trigger, or the depth-based flush could never fire.
    maxQueueSize: Math.max(DEFAULT_MAX_QUEUE_SIZE, maxExportBatchSize),
  }
}
