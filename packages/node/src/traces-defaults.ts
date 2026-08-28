import type { ResolvedTracesConfig, TracesConfig } from '@posthog/core'

// OpenTelemetry's BatchSpanProcessor defaults, which sit comfortably under the
// server's 2 MB body cap.
const DEFAULT_FLUSH_INTERVAL_MS = 5000
const DEFAULT_MAX_EXPORT_BATCH_SIZE = 512
const DEFAULT_MAX_QUEUE_SIZE = 2048

/**
 * Coerces a caller-supplied positive-integer option. `0`, a negative, or `NaN`
 * reaching the export loop would stall it.
 */
function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

const IDENTITY_KEYS = ['service.name', 'service.version', 'deployment.environment'] as const

/**
 * Drops a non-string identity key rather than letting it through: the resolver
 * would ignore it, and it would still reach the wire as an int and leave the
 * spans unattributable.
 */
function withUsableIdentityKeys(attributes: TracesConfig['resourceAttributes']): TracesConfig['resourceAttributes'] {
  // A primitive or array would otherwise be spread into attributes keyed "0", "1", "2".
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return undefined
  }
  try {
    if (IDENTITY_KEYS.every((key) => !(key in attributes) || typeof attributes[key] === 'string')) {
      return attributes
    }
    const usable = { ...attributes }
    for (const key of IDENTITY_KEYS) {
      if (key in usable && typeof usable[key] !== 'string') {
        delete usable[key]
      }
    }
    return usable
  } catch {
    // A throwing accessor on the config object must not escape `startSpan`.
    return undefined
  }
}

/**
 * Resolves the public `traces` config into the shape core `PostHogTraces` consumes.
 * OTLP resource attributes take precedence over the named fields, matching the
 * logs config — a user who sets `service.name` directly means it.
 */
export function resolveTracesConfig(config: TracesConfig | undefined): ResolvedTracesConfig {
  const resourceAttributes = withUsableIdentityKeys(config?.resourceAttributes)
  const maxExportBatchSize = positiveInteger(config?.maxExportBatchSize, DEFAULT_MAX_EXPORT_BATCH_SIZE)
  return {
    serviceName: (resourceAttributes?.['service.name'] as string | undefined) ?? config?.serviceName,
    serviceVersion: (resourceAttributes?.['service.version'] as string | undefined) ?? config?.serviceVersion,
    environment: (resourceAttributes?.['deployment.environment'] as string | undefined) ?? config?.environment,
    resourceAttributes,
    flushIntervalMs: positiveInteger(config?.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS),
    maxExportBatchSize,
    // Never below the flush trigger, or the depth-based flush could never fire.
    maxQueueSize: Math.max(positiveInteger(config?.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE), maxExportBatchSize),
  }
}
