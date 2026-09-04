// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

const CONTEXT_ARGUMENT_NAME = 'context'
const REDACTED_VALUE = '[redacted]'
const BINARY_REDACTED_VALUE = '[binary data redacted - not supported by PostHog MCP analytics]'
const BASE64_PATTERN = /^[A-Za-z0-9+/\n\r]+=*$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/
const BASE64URL_SPECIFIC_CHAR_PATTERN = /[-_]/
const BASE64_DATA_URL_PREFIX_PATTERN = /^data:[^,\s]*;base64,/i
const BASE64_DATA_URL_PAYLOAD_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/
const SIZE_GATE = 10_240
const POSTHOG_TOKEN_PATTERN = /\bph[a-z]_[A-Za-z0-9_-]{20,}\b/g
const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|api[-_]?token|access[-_]?token|refresh[-_]?token|token|password|secret|client[-_]?secret|private[-_]?key)$/i

// PII redaction for the agent-narrated intent string only. `$mcp_intent` is free
// text the calling LLM writes into the injected `context` argument, so it can
// carry personal data the model read aloud despite being told not to. We redact
// well-defined *structured identifiers* — the kind regex can match with high
// precision. Person names and postal addresses are deliberately out of scope:
// they need an NER model that a client SDK cannot ship, and naive patterns would
// over-redact ordinary prose. Patterns are ordered so an earlier pass never eats
// digits a later pass needs (email before phone, IPs before phone, cards before
// the generic phone pass). See `redactPii`.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g
// Full 8-group form, or any compressed form containing "::". Requiring "::" for
// the compressed branch keeps clock/time strings like "12:30:45" from matching.
const IPV6_PATTERN =
  /\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\b|\b[A-Fa-f0-9]{1,4}(?::[A-Fa-f0-9]{1,4}){0,6}::(?:[A-Fa-f0-9]{1,4}(?::[A-Fa-f0-9]{1,4}){0,6})?\b|::(?:[A-Fa-f0-9]{1,4}(?::[A-Fa-f0-9]{1,4}){0,6})/g
const US_SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g
// 13–19 digits, optionally grouped by single spaces or dashes. This only marks a
// candidate; the Luhn check in `redactPii` is what confirms it is a real card and
// keeps arbitrary long digit runs from being redacted.
const CREDIT_CARD_CANDIDATE_PATTERN = /\b\d(?:[ -]?\d){12,18}\b/g
// A permissive phone candidate; `redactPii` confirms it has 10–15 digits and at
// least one grouping character (`+`, parentheses, space, dash, or dot) so bare
// numeric IDs are left intact.
const PHONE_CANDIDATE_PATTERN = /\+?\d[\d ().-]{7,16}\d/g

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

function isBase64DataUrl(value: string): boolean {
  const prefix = BASE64_DATA_URL_PREFIX_PATTERN.exec(value)
  if (!prefix) {
    return false
  }

  let payload: string
  try {
    payload = decodeURIComponent(value.slice(prefix[0].length))
  } catch {
    return false
  }

  return BASE64_DATA_URL_PAYLOAD_PATTERN.test(payload.replace(/[\r\n]/g, ''))
}

function sanitizeString(value: string): string {
  if (
    value.length >= SIZE_GATE &&
    (BASE64_PATTERN.test(value) ||
      isBase64DataUrl(value) ||
      (BASE64URL_SPECIFIC_CHAR_PATTERN.test(value) && BASE64URL_PATTERN.test(value)))
  ) {
    return BINARY_REDACTED_VALUE
  }
  return value.replace(POSTHOG_TOKEN_PATTERN, REDACTED_VALUE)
}

function passesLuhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = digits.charCodeAt(index) - 48
    if (digit < 0 || digit > 9) {
      return false
    }
    if (double) {
      digit *= 2
      if (digit > 9) {
        digit -= 9
      }
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

/**
 * Redacts structured personal identifiers (emails, IP addresses, credit-card
 * numbers, US SSNs, and phone numbers) from a free-text string. Intended for the
 * agent-narrated `$mcp_intent` value only — not for structured tool parameters or
 * responses, where the same shapes are often legitimate data. Returns a new
 * string; leaves the input untouched when nothing matches.
 */
export function redactPii(value: string): string {
  let result = value.replace(EMAIL_PATTERN, REDACTED_VALUE)
  result = result.replace(IPV4_PATTERN, REDACTED_VALUE)
  result = result.replace(IPV6_PATTERN, REDACTED_VALUE)
  result = result.replace(CREDIT_CARD_CANDIDATE_PATTERN, (match) => {
    const digits = match.replace(/[ -]/g, '')
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits) ? REDACTED_VALUE : match
  })
  result = result.replace(US_SSN_PATTERN, REDACTED_VALUE)
  result = result.replace(PHONE_CANDIDATE_PATTERN, (match) => {
    const digits = match.replace(/\D/g, '')
    const hasGrouping = /[+() .-]/.test(match)
    return digits.length >= 10 && digits.length <= 15 && hasGrouping ? REDACTED_VALUE : match
  })
  return result
}

export function sanitizeCapturedValue(value: unknown): unknown {
  if (value == null) {
    return value
  }

  if (typeof value === 'string') {
    return sanitizeString(value)
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeCapturedValue)
  }

  if (value instanceof Date) {
    return value
  }

  if (typeof value !== 'object') {
    return value
  }

  const result: JsonRecord = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = shouldRedactKey(key) ? REDACTED_VALUE : sanitizeCapturedValue(nestedValue)
  }
  return result
}

function buildCapturedMcpArguments(argumentsValue: unknown): unknown {
  if (!isRecord(argumentsValue)) {
    return sanitizeCapturedValue(argumentsValue)
  }

  const capturedArguments: JsonRecord = {}
  for (const [key, value] of Object.entries(argumentsValue)) {
    if (key === CONTEXT_ARGUMENT_NAME) {
      continue
    }
    capturedArguments[key] = sanitizeCapturedValue(value)
  }
  return capturedArguments
}

function buildCapturedMcpParams(params: unknown): unknown {
  if (!isRecord(params)) {
    return sanitizeCapturedValue(params)
  }

  const capturedParams: JsonRecord = {}
  for (const [key, value] of Object.entries(params)) {
    capturedParams[key] = key === 'arguments' ? buildCapturedMcpArguments(value) : sanitizeCapturedValue(value)
  }
  return capturedParams
}

export function buildCapturedMcpParameters(request: unknown): JsonRecord {
  if (!isRecord(request)) {
    return { request: sanitizeCapturedValue(request) }
  }

  const capturedRequest: JsonRecord = {}
  for (const key of ['id', 'jsonrpc', 'method'] as const) {
    if (key in request) {
      capturedRequest[key] = sanitizeCapturedValue(request[key])
    }
  }

  if ('params' in request) {
    capturedRequest.params = buildCapturedMcpParams(request.params)
  }

  return { request: capturedRequest }
}
