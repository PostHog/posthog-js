import type { CaptureLogOptions, LogSeverityLevel } from './types'
import { isBoolean, isNumber, isUndefined } from '@posthog/core'

/**
 * SDK context auto-populated into log records
 */
export interface LogSdkContext {
    distinctId?: string
    sessionId?: string
    currentUrl?: string
    activeFeatureFlags?: string[]
    lib: string
}

// ============================================================================
// Severity mapping
// ============================================================================

const SEVERITY_TEXT_MAP: Record<LogSeverityLevel, string> = {
    trace: 'TRACE',
    debug: 'DEBUG',
    info: 'INFO',
    warn: 'WARN',
    error: 'ERROR',
    fatal: 'FATAL',
}

const SEVERITY_NUMBER_MAP: Record<LogSeverityLevel, number> = {
    trace: 1,
    debug: 5,
    info: 9,
    warn: 13,
    error: 17,
    fatal: 21,
}

export function severityTextFromLevel(level: LogSeverityLevel): string {
    return SEVERITY_TEXT_MAP[level] || 'INFO'
}

export function severityNumberFromLevel(level: LogSeverityLevel): number {
    return SEVERITY_NUMBER_MAP[level] || 9
}

// ============================================================================
// OTLP AnyValue conversion
// ============================================================================

interface OtlpAnyValue {
    stringValue?: string
    intValue?: number
    doubleValue?: number
    boolValue?: boolean
}

interface OtlpKeyValue {
    key: string
    value: OtlpAnyValue
}

export function toOtlpAnyValue(value: string | number | boolean): OtlpAnyValue {
    if (isBoolean(value)) {
        return { boolValue: value }
    }
    if (isNumber(value)) {
        if (Number.isInteger(value)) {
            return { intValue: value }
        }
        return { doubleValue: value }
    }
    return { stringValue: String(value) }
}

export function toOtlpKeyValueList(attrs: Record<string, string | number | boolean>): OtlpKeyValue[] {
    return Object.entries(attrs).map(([key, value]) => ({
        key,
        value: toOtlpAnyValue(value),
    }))
}

// ============================================================================
// OTLP LogRecord construction
// ============================================================================

function timestampToUnixNano(): string {
    // OTLP expects nanoseconds as a string (uint64 doesn't fit in JS number)
    return String(Date.now() * 1_000_000)
}

export interface OtlpLogRecord {
    timeUnixNano: string
    observedTimeUnixNano: string
    severityNumber: number
    severityText: string
    body: { stringValue: string }
    attributes: OtlpKeyValue[]
    traceId?: string
    spanId?: string
    flags?: number
}

export function buildOtlpLogRecord(options: CaptureLogOptions, sdkContext: LogSdkContext): OtlpLogRecord {
    const level = options.level || 'info'
    const now = timestampToUnixNano()

    // Build attributes: auto-populated + user-provided (user wins on conflicts)
    const autoAttributes: Record<string, string | number | boolean> = {}

    if (sdkContext.distinctId) {
        autoAttributes.posthogDistinctId = sdkContext.distinctId
    }
    if (sdkContext.sessionId) {
        autoAttributes['sessionId'] = sdkContext.sessionId
    }
    if (sdkContext.currentUrl) {
        autoAttributes['url.full'] = sdkContext.currentUrl
    }
    if (sdkContext.activeFeatureFlags && sdkContext.activeFeatureFlags.length > 0) {
        autoAttributes['feature_flags'] = JSON.stringify(sdkContext.activeFeatureFlags)
    }

    const mergedAttributes = {
        ...autoAttributes,
        ...(options.attributes || {}),
    }

    const record: OtlpLogRecord = {
        timeUnixNano: now,
        observedTimeUnixNano: now,
        severityNumber: severityNumberFromLevel(level),
        severityText: severityTextFromLevel(level),
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

export interface OtlpLogsPayload {
    resourceLogs: Array<{
        resource: { attributes: OtlpKeyValue[] }
        scopeLogs: Array<{
            scope: { name: string; version?: string }
            logRecords: OtlpLogRecord[]
        }>
    }>
}

export function buildOtlpLogsPayload(
    logRecords: OtlpLogRecord[],
    resourceAttributes: Record<string, string | number | boolean>,
    scopeName: string = 'posthog-js'
): OtlpLogsPayload {
    return {
        resourceLogs: [
            {
                resource: {
                    attributes: toOtlpKeyValueList(resourceAttributes),
                },
                scopeLogs: [
                    {
                        scope: { name: scopeName },
                        logRecords,
                    },
                ],
            },
        ],
    }
}
