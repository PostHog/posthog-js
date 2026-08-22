import type {
  CaptureLogOptions,
  LogAttributeValue,
  LogSeverityLevel,
  OtlpLogRecord,
  OtlpLogsPayload,
  OtlpSeverityEntry,
  OtlpSeverityText,
} from '@posthog/types'
import type { Logger } from '../types'
import type { LogSdkContext, ResolvedPostHogLogsConfig } from './types'
import { isNullish, isUndefined } from '../utils'
import { sanitizeString, UNSERIALIZABLE_VALUE } from '../utils/json-utils'
import { toOtlpKeyValueList } from '../utils/otlp-any-value'

// ============================================================================
// Severity mapping
// ============================================================================

const OTLP_SEVERITY_MAP: Record<LogSeverityLevel, OtlpSeverityEntry> = {
  trace: { text: 'TRACE', number: 1 },
  debug: { text: 'DEBUG', number: 5 },
  info: { text: 'INFO', number: 9 },
  warn: { text: 'WARN', number: 13 },
  error: { text: 'ERROR', number: 17 },
  fatal: { text: 'FATAL', number: 21 },
}

const DEFAULT_OTLP_SEVERITY = OTLP_SEVERITY_MAP.info

export function getOtlpSeverityText(level: LogSeverityLevel): OtlpSeverityText {
  return (OTLP_SEVERITY_MAP[level] || DEFAULT_OTLP_SEVERITY).text
}

export function getOtlpSeverityNumber(level: LogSeverityLevel): number {
  return (OTLP_SEVERITY_MAP[level] || DEFAULT_OTLP_SEVERITY).number
}

// ============================================================================
// OTLP LogRecord construction
// ============================================================================

/**
 * Returns the current wall-clock time as a unix-nanos string.
 *
 * OTLP requires nanoseconds as a string (uint64 doesn't fit in JS Number).
 * `Date.now() * 1_000_000` would exceed Number.MAX_SAFE_INTEGER, so we
 * concatenate instead of multiplying.
 */
function timestampToUnixNano(): string {
  return String(Date.now()) + '000000'
}

/**
 * Builds a single OTLP log record.
 *
 * Auto-attribute population is shape-driven: any field present on `sdkContext`
 * is emitted as the corresponding attribute. Each SDK populates only the
 * fields that apply to it (browser fills `currentUrl`; mobile fills
 * `screenName` / `appState`), so a missing field never adds a stray attribute.
 *
 * User-provided `options.attributes` always wins on conflicts.
 */
// `body` is only typed as a string. An untyped caller — or a `beforeSend` that
// rewrites it — can pass anything, and `String()` throws on a value whose
// `toString` does, or on a null-prototype object.
function encodeBody(body: string): string {
  try {
    return sanitizeString(String(body))
  } catch {
    return UNSERIALIZABLE_VALUE
  }
}

export function buildOtlpLogRecord(
  options: CaptureLogOptions,
  sdkContext: LogSdkContext,
  logger?: Logger
): OtlpLogRecord {
  const level: LogSeverityLevel = options.level || 'info'
  const { text: severityText, number: severityNumber } = OTLP_SEVERITY_MAP[level] || DEFAULT_OTLP_SEVERITY
  const now = timestampToUnixNano()

  const autoAttributes: Record<string, LogAttributeValue> = {}

  if (sdkContext.distinctId) {
    autoAttributes.posthogDistinctId = sdkContext.distinctId
  }
  if (sdkContext.sessionId) {
    autoAttributes.sessionId = sdkContext.sessionId
  }
  if (sdkContext.windowId) {
    autoAttributes['window.id'] = sdkContext.windowId
  }
  if (!isNullish(sdkContext.sessionStartTimestamp)) {
    autoAttributes.sessionStartTimestamp = String(sdkContext.sessionStartTimestamp)
  }
  if (!isNullish(sdkContext.lastActivityTimestamp)) {
    autoAttributes.lastActivityTimestamp = String(sdkContext.lastActivityTimestamp)
  }
  if (sdkContext.currentUrl) {
    autoAttributes['url.full'] = sdkContext.currentUrl
  }
  if (sdkContext.screenName) {
    autoAttributes['screen.name'] = sdkContext.screenName
  }
  if (sdkContext.appState) {
    autoAttributes['app.state'] = sdkContext.appState
  }
  if (sdkContext.activeFeatureFlags && sdkContext.activeFeatureFlags.length > 0) {
    autoAttributes.feature_flags = sdkContext.activeFeatureFlags
  }

  // Read key by key rather than spreading: a getter over a disposed store or a
  // revoked proxy throws on the read itself, before the encoder's guards see it.
  const mergedAttributes: Record<string, LogAttributeValue> = { ...autoAttributes }
  const userAttributes = options.attributes
  if (userAttributes) {
    let keys: string[] = []
    try {
      keys = Object.keys(userAttributes)
    } catch {
      keys = []
    }
    for (const key of keys) {
      let value: LogAttributeValue
      try {
        value = userAttributes[key]
      } catch {
        value = UNSERIALIZABLE_VALUE
      }
      // defineProperty, not assignment: `attributes['__proto__'] = v` hits the
      // prototype setter and the attribute vanishes.
      Object.defineProperty(mergedAttributes, key, { value, enumerable: true, writable: true, configurable: true })
    }
  }

  const record: OtlpLogRecord = {
    timeUnixNano: now,
    observedTimeUnixNano: now,
    severityNumber,
    severityText,
    body: { stringValue: encodeBody(options.body) },
    attributes: toOtlpKeyValueList(mergedAttributes, logger),
  }

  if (options.trace_id) {
    record.traceId = options.trace_id
  }
  if (options.span_id) {
    record.spanId = options.span_id
  }
  if (!isUndefined(options.trace_flags)) {
    record.flags = options.trace_flags
  }

  return record
}

// ============================================================================
// OTLP envelope construction
// ============================================================================

/**
 * OTLP resource attributes for every batch, shared by the core flush path and
 * SDK-specific paths that bypass it (e.g. the browser's synchronous sendBeacon
 * drain). Having one builder keeps those paths from drifting.
 *
 * Layout: user `resourceAttributes` spread first, then SDK-controlled keys
 * (`service.name`, `deployment.environment`, `service.version`,
 * `telemetry.sdk.*`) layered on top so a stray user key can't clobber the
 * ingestion-attribution keys. The dedicated `serviceName` / `environment` /
 * `serviceVersion` config fields are the supported way to override the first
 * three; each SDK resolves its own `service.name` default before this point, so
 * the `unknown_service` fallback here only fires if a config slips through with
 * an empty `serviceName`.
 */
export function buildResourceAttributes(
  config: ResolvedPostHogLogsConfig,
  sdkName: string,
  sdkVersion: string
): Record<string, LogAttributeValue> {
  return {
    ...config.resourceAttributes,
    'service.name': config.serviceName || 'unknown_service',
    ...(config.environment && { 'deployment.environment': config.environment }),
    ...(config.serviceVersion && { 'service.version': config.serviceVersion }),
    'telemetry.sdk.name': sdkName,
    'telemetry.sdk.version': sdkVersion,
  }
}

/**
 * Wraps a list of records in the OTLP `resourceLogs` envelope.
 *
 * `scopeName` is the OTLP instrumentation scope name (`web`/`console` for
 * browser, or the SDK library ID for other platforms). `scopeVersion` is the
 * SDK semver. The server combines them into a single `instrumentation_scope`
 * field (`{name}@{version}`) used for attribution in queries and dashboards.
 */
export function buildOtlpLogsPayload(
  logRecords: OtlpLogRecord[],
  resourceAttributes: Record<string, LogAttributeValue>,
  scopeName: string,
  scopeVersion: string
): OtlpLogsPayload {
  return {
    resourceLogs: [
      {
        resource: { attributes: toOtlpKeyValueList(resourceAttributes) },
        scopeLogs: [
          {
            scope: { name: scopeName, version: scopeVersion },
            logRecords,
          },
        ],
      },
    ],
  }
}
