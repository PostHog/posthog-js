import { assignUserAttributes } from '@posthog/core'
import type { BeforeSpanSendFn, ResolvedTracesConfig, TracesConfig } from '@posthog/core'

// OpenTelemetry's BatchSpanProcessor defaults, which sit comfortably under the
// server's 2 MB body cap.
const DEFAULT_FLUSH_INTERVAL_MS = 5000
const DEFAULT_MAX_EXPORT_BATCH_SIZE = 512
const DEFAULT_MAX_QUEUE_SIZE = 2048
// OpenTelemetry's per-span defaults.
const DEFAULT_MAX_ATTRIBUTES_PER_SPAN = 128
const DEFAULT_MAX_EVENTS_PER_SPAN = 128
// OpenTelemetry leaves the value length unlimited, which is what lets one
// multi-MB attribute make a span too large for the endpoint to accept — and an
// oversized span is dropped whole. 8 KB holds a deep stack trace and any
// realistic header, query string or payload excerpt, and keeps a span at the
// attribute cap under 1 MB, comfortably inside the 2 MB body cap.
const DEFAULT_MAX_ATTRIBUTE_VALUE_LENGTH = 8192

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
 * Keeps only the callable hooks. Anything else is dropped rather than called: an
 * untyped caller passing the wrong shape would otherwise have every span dropped
 * by a hook that throws, leaving tracing silently off.
 */
function resolveBeforeSpanSend(beforeSpanSend: TracesConfig['beforeSpanSend']): BeforeSpanSendFn[] {
  if (!beforeSpanSend) {
    return []
  }
  return [beforeSpanSend].flat().filter((hook): hook is BeforeSpanSendFn => typeof hook === 'function')
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
    beforeSpanSend: resolveBeforeSpanSend(config?.beforeSpanSend),
    maxAttributesPerSpan: positiveInteger(config?.maxAttributesPerSpan, DEFAULT_MAX_ATTRIBUTES_PER_SPAN),
    maxEventsPerSpan: positiveInteger(config?.maxEventsPerSpan, DEFAULT_MAX_EVENTS_PER_SPAN),
    maxAttributeValueLength: positiveInteger(config?.maxAttributeValueLength, DEFAULT_MAX_ATTRIBUTE_VALUE_LENGTH),
    flushIntervalMs: positiveInteger(config?.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS),
    maxExportBatchSize,
    // Never below the flush trigger, or the depth-based flush could never fire.
    maxQueueSize: Math.max(positiveInteger(config?.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE), maxExportBatchSize),
    maxLiveSpans: positiveInteger(config?.maxLiveSpans, DEFAULT_MAX_LIVE_SPANS),
    maxSpanAgeMs: positiveInteger(config?.maxSpanAgeMs, DEFAULT_MAX_SPAN_AGE_MS),
  }
}
