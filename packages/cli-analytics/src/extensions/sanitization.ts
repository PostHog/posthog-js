import type { CliEvent, JsonRecord } from '../types'

// Captured free-text (intent) and custom properties can accidentally carry a
// secret a user typed or an agent narrated. Redact the obvious shapes before
// anything leaves the process. This is a safety net, not a guarantee — the
// schema captures flag NAMES only, never values, precisely to avoid this class
// of leak at the source.

const REDACTED = '[redacted]'

/** PostHog API keys, bearer tokens, and other high-signal secret prefixes. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
    /\bph[a-z]_[A-Za-z0-9]{16,}\b/g, // PostHog keys: phc_, phx_, phs_, ...
    /\bsk-[A-Za-z0-9]{16,}\b/g, // OpenAI-style secret keys
    /\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub personal access tokens
    /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
]

/** Keys whose values are redacted wholesale, regardless of content. */
const SENSITIVE_KEY = /(password|passwd|secret|token|api[_-]?key|authorization|auth|credential|private[_-]?key)/i

function redactString(value: string): string {
    let result = value
    for (const pattern of SECRET_VALUE_PATTERNS) {
        result = result.replace(pattern, REDACTED)
    }
    return result
}

function sanitizeValue(value: unknown): unknown {
    if (typeof value === 'string') {
        return redactString(value)
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeValue)
    }
    if (value && typeof value === 'object') {
        const result: JsonRecord = {}
        for (const [key, inner] of Object.entries(value as JsonRecord)) {
            result[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(inner)
        }
        return result
    }
    return value
}

/**
 * Returns a copy of the event with secrets redacted from the agent-supplied
 * intent and from custom properties. Runs synchronously, after any consumer
 * `beforeSend` redaction, as the last line of defence in the pipeline.
 */
export function sanitizeEvent(event: CliEvent): CliEvent {
    const result = { ...event }
    if (typeof result.intent === 'string') {
        result.intent = redactString(result.intent)
    }
    if (result.properties) {
        result.properties = sanitizeValue(result.properties) as JsonRecord
    }
    return result
}
