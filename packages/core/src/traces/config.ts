import { assignUserAttributes } from '../utils/json-utils'
import type { ResolvedTracesConfig } from './types'
import type { TracesConfig } from '@posthog/types'

// OpenTelemetry's BatchSpanProcessor defaults, which sit comfortably under the
// server's request body cap.
const DEFAULT_FLUSH_INTERVAL_MS = 5000
const DEFAULT_MAX_EXPORT_BATCH_SIZE = 512
const DEFAULT_MAX_QUEUE_SIZE = 2048

// Live-span bounds. A server can legitimately hold thousands of spans open at
// once, and refusing a legitimate span is worse than tolerating a leak, so the
// count bound sits well above realistic concurrency — affordable because live
// accounting is an id and a timestamp per span, not the span. The age bound is
// an hour: production traces routinely run past ten minutes, and a span still
// open after an hour is a leak rather than slow work.
const DEFAULT_MAX_LIVE_SPANS = 10_000
const DEFAULT_MAX_SPAN_AGE_MS = 3_600_000

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
 * logs config. `hostResourceAttributes` are runtime-detected by the entrypoint and
 * merge first, so a user-supplied value of the same key wins.
 */
export function resolveTracesConfig(
  config: TracesConfig | undefined,
  hostResourceAttributes?: Record<string, string>
): ResolvedTracesConfig {
  // Copied key by key rather than spread: a throwing accessor on a user-supplied
  // attribute would otherwise escape the first `startSpan`.
  const resourceAttributes = assignUserAttributes(
    { ...hostResourceAttributes },
    withUsableIdentityKeys(config?.resourceAttributes)
  )
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
    maxLiveSpans: positiveInteger(config?.maxLiveSpans, DEFAULT_MAX_LIVE_SPANS),
    maxSpanAgeMs: positiveInteger(config?.maxSpanAgeMs, DEFAULT_MAX_SPAN_AGE_MS),
  }
}
