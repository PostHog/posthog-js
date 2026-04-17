/**
 * Log capture types
 */

export type LogSeverityLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export type OtlpSeverityText = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

export interface OtlpSeverityEntry {
    text: OtlpSeverityText
    number: number
}

export type LogAttributeValue = string | number | boolean | null | undefined | unknown[] | Record<string, unknown>

export type LogAttributes = Record<string, LogAttributeValue>

export interface CaptureLogOptions {
    /** The log message body (required) */
    body: string
    /** Log severity level (default: 'info') */
    level?: LogSeverityLevel
    /** Trace ID for correlation — 32 hex chars */
    trace_id?: string
    /** Span ID for correlation — 16 hex chars */
    span_id?: string
    /** W3C trace flags (default: 0) */
    trace_flags?: number
    /** Per-log attributes (request-specific context like order_id, duration_ms) */
    attributes?: LogAttributes
}

export interface Logger {
    trace(body: string, attributes?: LogAttributes): void
    debug(body: string, attributes?: LogAttributes): void
    info(body: string, attributes?: LogAttributes): void
    warn(body: string, attributes?: LogAttributes): void
    error(body: string, attributes?: LogAttributes): void
    fatal(body: string, attributes?: LogAttributes): void
}

// ============================================================================
// OTLP wire format types
// ============================================================================

export interface OtlpAnyValue {
    stringValue?: string
    intValue?: number
    doubleValue?: number
    boolValue?: boolean
    arrayValue?: { values: OtlpAnyValue[] }
}

export interface OtlpKeyValue {
    key: string
    value: OtlpAnyValue
}

export interface OtlpLogRecord {
    timeUnixNano: string
    observedTimeUnixNano: string
    severityNumber: number
    severityText: OtlpSeverityText
    body: { stringValue: string }
    attributes: OtlpKeyValue[]
    traceId?: string
    spanId?: string
    flags?: number
}

export interface OtlpLogsPayload {
    resourceLogs: Array<{
        resource: { attributes: OtlpKeyValue[] }
        scopeLogs: Array<{
            scope: { name: string; version?: string }
            logRecords: OtlpLogRecord[]
        }>
    }>
}

export interface LogSdkContext {
    distinctId?: string
    sessionId?: string
    currentUrl?: string
    activeFeatureFlags?: string[]
    lib: string
}
