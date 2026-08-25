import type {
  CaptureLogOptions,
  LogAttributeValue,
  LogSeverityLevel,
  OtlpAnyValue,
  OtlpKeyValue,
  OtlpLogRecord,
  OtlpLogsPayload,
  OtlpSeverityEntry,
  OtlpSeverityText,
} from '@posthog/types'
import type { Logger } from '../types'
import type { LogSdkContext, ResolvedPostHogLogsConfig } from './types'
import { isArray, isBoolean, isNull, isNullish, isNumber, isUndefined } from '../utils'
import {
  CIRCULAR_VALUE,
  FUNCTION_VALUE,
  MAX_JSON_SAFE_VALUE_DEPTH,
  MAX_JSON_SAFE_VALUE_ITEMS,
  MAX_JSON_SAFE_VALUE_NODES,
  sanitizeString,
  TRUNCATED_VALUE,
  UNSERIALIZABLE_VALUE,
} from '../utils/json-utils'

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
// OTLP AnyValue conversion
// ============================================================================

// 2^63 — one past int64 max.
const INT64_RANGE_LIMIT = 9223372036854775808

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

interface EncodeState {
  /** Containers on the current path, so a back-reference becomes a marker. */
  ancestors: WeakSet<object>
  remainingNodes: number
}

function newState(): EncodeState {
  return { ancestors: new WeakSet(), remainingNodes: MAX_JSON_SAFE_VALUE_NODES }
}

export function toOtlpAnyValue(value: LogAttributeValue, logger?: Logger): OtlpAnyValue {
  try {
    return encodeAnyValue(value, logger, newState(), 0)
  } catch {
    // Runs inside `captureLog` and the metrics flush: an error escaping here
    // surfaces in the caller's own code.
    return { stringValue: UNSERIALIZABLE_VALUE }
  }
}

export function toOtlpKeyValueList(attrs: Record<string, LogAttributeValue>, logger?: Logger): OtlpKeyValue[] {
  try {
    return encodeKeyValueList(attrs, logger, newState(), 0)
  } catch {
    return []
  }
}

function encodeAnyValue(
  value: LogAttributeValue,
  logger: Logger | undefined,
  state: EncodeState,
  depth: number
): OtlpAnyValue {
  if (state.remainingNodes <= 0) {
    return { stringValue: TRUNCATED_VALUE }
  }
  state.remainingNodes--

  if (isBoolean(value)) {
    return { boolValue: value }
  }
  // typeof, not core's isNumber, which excludes NaN — proto3 JSON distinguishes
  // a non-finite float from an ordinary string.
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { stringValue: String(value) }
    }
    if (Number.isInteger(value)) {
      if (Number.isSafeInteger(value)) {
        return { intValue: String(value) }
      }
      // Past MAX_SAFE_INTEGER only BigInt gives the double's exact decimal:
      // `String(-(2**63))` lands 192 below int64 min, outside the field it is
      // about to be parsed into. Without BigInt the value rides as a string,
      // which is never range-checked.
      if (typeof BigInt === 'undefined') {
        return { stringValue: String(value) }
      }
      const decimal = BigInt(value).toString()
      if (value >= INT64_RANGE_LIMIT || value < -INT64_RANGE_LIMIT) {
        // An out-of-range intValue 400s the whole logs request; on the metrics
        // path it is swallowed server-side and the metric just disappears.
        logger?.debug(`Attribute ${decimal} is outside the int64 range; encoding it as a string`)
        return { stringValue: decimal }
      }
      return { intValue: decimal }
    }
    return { doubleValue: value }
  }
  if (typeof value === 'string') {
    return { stringValue: sanitizeString(value) }
  }
  // `String(value)` would put a function's source text on the wire.
  if (typeof value === 'function') {
    return { stringValue: FUNCTION_VALUE }
  }
  if (typeof value === 'symbol') {
    return { stringValue: String(value) }
  }
  if (typeof value === 'object' && value !== null) {
    if (state.ancestors.has(value)) {
      return { stringValue: CIRCULAR_VALUE }
    }
    if (depth >= MAX_JSON_SAFE_VALUE_DEPTH) {
      return { stringValue: TRUNCATED_VALUE }
    }
    if (value instanceof Date) {
      const time = value.getTime()
      const iso = Number.isFinite(time) ? value.toISOString() : String(value)
      // An overridden toISOString can return a non-string, which the server
      // refuses for the whole request.
      return { stringValue: typeof iso === 'string' ? sanitizeString(iso) : String(iso) }
    }
    // Registered before the toJSON probe: a toJSON returning a structure that
    // references its own object is a cycle like any other.
    state.ancestors.add(value)
    try {
      // The representation a value defines for itself — dayjs, Decimal, an ORM
      // document, and a cross-realm Date that fails the `instanceof` above.
      try {
        const toJSON = (value as { toJSON?: unknown }).toJSON
        if (typeof toJSON === 'function') {
          return encodeAnyValue(toJSON.call(value) as LogAttributeValue, logger, state, depth + 1)
        }
      } catch {
        // A throwing toJSON falls through to the plain walk.
      }
      if (isArray(value)) {
        return { arrayValue: { values: encodeArrayValues(value, logger, state, depth + 1) } }
      }
      return {
        kvlistValue: {
          values: encodeKeyValueList(value as Record<string, LogAttributeValue>, logger, state, depth + 1),
        },
      }
    } finally {
      // Siblings that reference the same object are duplication, not a cycle.
      state.ancestors.delete(value)
    }
  }
  return { stringValue: sanitizeString(String(value)) }
}

function encodeArrayValues(
  values: unknown[],
  logger: Logger | undefined,
  state: EncodeState,
  depth: number
): OtlpAnyValue[] {
  const result: OtlpAnyValue[] = []
  const itemCount = Math.min(values.length, MAX_JSON_SAFE_VALUE_ITEMS)
  let index = 0
  for (; index < itemCount && state.remainingNodes > 0; index++) {
    try {
      const element = index in values ? values[index] : undefined
      // Dropped, as iOS and Android do: proto3 JSON has no null AnyValue, and
      // both `null` and `{}` here are rejected for the whole request.
      if (isNullish(element)) {
        continue
      }
      result.push(encodeAnyValue(element as LogAttributeValue, logger, state, depth))
    } catch {
      result.push({ stringValue: UNSERIALIZABLE_VALUE })
    }
  }
  if (values.length > index) {
    result.push({ stringValue: TRUNCATED_VALUE })
  }
  return result
}

function encodeKeyValueList(
  attrs: Record<string, LogAttributeValue>,
  logger: Logger | undefined,
  state: EncodeState,
  depth: number
): OtlpKeyValue[] {
  const result: OtlpKeyValue[] = []
  for (const key in attrs) {
    // for...in walks the prototype chain once own keys are exhausted. Skipped
    // rather than broken out of: a proxy can yield keys in any order.
    if (!propertyIsEnumerable.call(attrs, key)) {
      continue
    }
    if (result.length >= MAX_JSON_SAFE_VALUE_ITEMS || state.remainingNodes <= 0) {
      // Reported rather than written into the attributes: a synthetic key would
      // land in the user's own namespace and could collide with a real one.
      logger?.debug('Attributes truncated: the value exceeds the OTLP encoder budget')
      break
    }
    try {
      const value = attrs[key]
      if (isNull(value) || isUndefined(value)) {
        continue
      }
      result.push({ key: sanitizeString(key), value: encodeAnyValue(value, logger, state, depth) })
    } catch {
      // A getter that throws costs its own key, not the whole record.
      result.push({ key: sanitizeString(key), value: { stringValue: UNSERIALIZABLE_VALUE } })
    }
  }
  return result
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
function timestampToUnixNano(timestampMs: number = Date.now()): string {
  return String(timestampMs) + '000000'
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
 *
 * `occurredAtMs` is when the event happened, for a host that records an event earlier
 * than it can build the record; it stamps both OTLP timestamps, which the logs spec
 * requires to be equal.
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
  logger?: Logger,
  occurredAtMs?: number
): OtlpLogRecord {
  const level: LogSeverityLevel = options.level || 'info'
  const { text: severityText, number: severityNumber } = OTLP_SEVERITY_MAP[level] || DEFAULT_OTLP_SEVERITY
  const eventTimeNano = timestampToUnixNano(isNumber(occurredAtMs) ? occurredAtMs : undefined)

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
    timeUnixNano: eventTimeNano,
    observedTimeUnixNano: eventTimeNano,
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
