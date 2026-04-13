import type {
    CaptureLogOptions,
    LogAttributeValue,
    LogSeverityLevel,
    OtlpSeverityEntry,
    OtlpSeverityText,
    OtlpAnyValue,
    OtlpKeyValue,
    OtlpLogRecord,
    OtlpLogsPayload,
    LogSdkContext,
} from './types'
import { isArray, isBoolean, isNull, isNumber, isUndefined } from '@posthog/core'
import Config from './config'

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

export function toOtlpAnyValue(value: LogAttributeValue): OtlpAnyValue {
    if (isBoolean(value)) {
        return { boolValue: value }
    }
    if (isNumber(value)) {
        if (Number.isInteger(value)) {
            return { intValue: value }
        }
        return { doubleValue: value }
    }
    if (typeof value === 'string') {
        return { stringValue: value }
    }
    if (isArray(value)) {
        return { arrayValue: { values: value.map((v) => toOtlpAnyValue(v as LogAttributeValue)) } }
    }
    // Objects fall back to JSON — OTLP supports kvlistValue but our encoder stays flat for simplicity
    try {
        return { stringValue: JSON.stringify(value) }
    } catch {
        return { stringValue: String(value) }
    }
}

export function toOtlpKeyValueList(attrs: Record<string, LogAttributeValue>): OtlpKeyValue[] {
    const result: OtlpKeyValue[] = []
    for (const key in attrs) {
        const value = attrs[key]
        if (isNull(value) || isUndefined(value)) {
            continue
        }
        result.push({ key, value: toOtlpAnyValue(value) })
    }
    return result
}

// ============================================================================
// OTLP LogRecord construction
// ============================================================================

function timestampToUnixNano(): string {
    // OTLP expects nanoseconds as a string (uint64 doesn't fit in JS number)
    // Date.now() * 1_000_000 exceeds Number.MAX_SAFE_INTEGER, so we concat instead of multiply
    return String(Date.now()) + '000000'
}

export function buildOtlpLogRecord(options: CaptureLogOptions, sdkContext: LogSdkContext): OtlpLogRecord {
    const level: LogSeverityLevel = options.level || 'info'
    const { text: severityText, number: severityNumber } = OTLP_SEVERITY_MAP[level] || DEFAULT_OTLP_SEVERITY
    const now = timestampToUnixNano()

    // Build attributes: auto-populated + user-provided (user wins on conflicts)
    const autoAttributes: Record<string, LogAttributeValue> = {}

    if (sdkContext.distinctId) {
        autoAttributes.posthogDistinctId = sdkContext.distinctId
    }
    if (sdkContext.sessionId) {
        autoAttributes.sessionId = sdkContext.sessionId
    }
    if (sdkContext.currentUrl) {
        autoAttributes['url.full'] = sdkContext.currentUrl
    }
    if (sdkContext.activeFeatureFlags && sdkContext.activeFeatureFlags.length > 0) {
        autoAttributes.feature_flags = sdkContext.activeFeatureFlags
    }

    const mergedAttributes = {
        ...autoAttributes,
        ...(options.attributes || {}),
    }

    const record: OtlpLogRecord = {
        timeUnixNano: now,
        observedTimeUnixNano: now,
        severityNumber,
        severityText,
        body: { stringValue: options.body },
        attributes: toOtlpKeyValueList(mergedAttributes),
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

export function buildOtlpLogsPayload(
    logRecords: OtlpLogRecord[],
    resourceAttributes: Record<string, LogAttributeValue>
): OtlpLogsPayload {
    return {
        resourceLogs: [
            {
                resource: {
                    attributes: toOtlpKeyValueList(resourceAttributes),
                },
                scopeLogs: [
                    {
                        scope: { name: Config.LIB_NAME },
                        logRecords,
                    },
                ],
            },
        ],
    }
}
