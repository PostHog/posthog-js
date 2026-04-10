/**
 * Log capture types
 */

export type LogSeverityLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface CaptureLogOptions {
    /** The log message body (required) */
    body: string
    /** Log severity level (default: 'info') */
    level?: LogSeverityLevel
    /** Service name (default: SDK $lib value, e.g. 'posthog-js') */
    service_name?: string
    /** Trace ID for correlation — 32 hex chars */
    trace_id?: string
    /** Span ID for correlation — 16 hex chars */
    span_id?: string
    /** W3C trace flags (default: 0) */
    trace_flags?: number
    /** Per-log attributes (request-specific context like order_id, duration_ms) */
    attributes?: Record<string, string | number | boolean>
    /** Resource attributes (service-level context like service.version, deployment.environment) */
    resource_attributes?: Record<string, string | number | boolean>
}
