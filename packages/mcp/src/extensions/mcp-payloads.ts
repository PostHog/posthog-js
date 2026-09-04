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
// Horizontal Unicode spaces (NBSP, narrow NBSP, ideographic space, ...) are what
// appear when text is copied from web pages or PDFs. `redactPii` normalizes them
// to an ASCII space first so the separator-based card/phone/SSN candidates match
// them instead of leaking the identifier they group.
const UNICODE_SPACE_PATTERN = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g
// Quantifiers are bounded to RFC-ish limits (local-part <=64, domain <=255,
// TLD <=24) rather than open-ended `+`. Unbounded `+` here is quadratic: on a
// long run of local-part chars with no valid `.tld`, `replace` rescans from
// every start position. `$mcp_intent` is attacker-influenceable free text seen
// before truncation, so an open-ended pattern is a reachable event-loop stall.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g
// Four forms: full 8-group, `::`-terminated (`2001:db8::`), a middle `::`
// (`2001:db8::8a2e:1`), and a leading `::` (`::1`). The compressed branches use a
// `(?<![\w:])` boundary so a hex-looking C++ scope like `std::bad` — whose left
// side is not a valid hex group — is not mistaken for an address, while a
// genuinely address-shaped `dead::beef` still matches.
const IPV6_PATTERN =
  /\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b|(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){1,7}:(?![\w:])|(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,5}(?![\w])|(?<![\w:])::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})(?![\w])/g
// A separator (space, dot, or dash) is required between the 3-2-4 groups so bare
// 9-digit IDs are never mistaken for an SSN.
const US_SSN_PATTERN = /\b\d{3}[ .-]\d{2}[ .-]\d{4}\b/g
// 13–19 digits, optionally grouped by a single space, dot, dash, or slash. This
// only marks a candidate; the Luhn check in `redactPii` is what confirms it is a
// real card, so widening the separators cannot add false positives — it only
// lets dot/slash-grouped cards reach the check instead of leaking past it.
const CREDIT_CARD_CANDIDATE_PATTERN = /\b\d(?:[ ./-]?\d){12,18}\b/g
// Phone matching is structural rather than "any 10–15 digits", so dates
// (`2024-01-15 12:30`) and dotted versions are not mistaken for numbers. Two
// forms: a North-American 3-3-4 grouping that requires a real separator (space,
// dot, dash, or slash, optional parens and `+1`), and an international number
// that must start with `+` and a country code.
const PHONE_NANP_PATTERN = /(?<![\w+])(?:\+?1[ ./-]?)?\(?\d{3}\)?[ ./-]\d{3}[ ./-]\d{4}(?![\w])/g
const PHONE_INTL_PATTERN = /(?<!\w)\+\d{1,3}(?:[ ./()-]{0,2}\d){7,13}(?![\w])/g

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
 * responses, where the same shapes are often legitimate data. Horizontal Unicode
 * spaces are first normalized to an ASCII space so copy-pasted identifiers still
 * match. Returns a new string; leaves the input's identifiers untouched when
 * nothing matches.
 */
export function redactPii(value: string): string {
  let result = value.replace(UNICODE_SPACE_PATTERN, ' ')
  result = result.replace(EMAIL_PATTERN, REDACTED_VALUE)
  result = result.replace(IPV4_PATTERN, REDACTED_VALUE)
  result = result.replace(IPV6_PATTERN, REDACTED_VALUE)
  // Card grouping (space/dot/dash/slash) is stripped so only the Luhn check on
  // the digits decides — a non-card digit run of the same length is left intact.
  result = result.replace(CREDIT_CARD_CANDIDATE_PATTERN, (match) => {
    const digits = match.replace(/[ ./-]/g, '')
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits) ? REDACTED_VALUE : match
  })
  result = result.replace(US_SSN_PATTERN, REDACTED_VALUE)
  result = result.replace(PHONE_NANP_PATTERN, REDACTED_VALUE)
  result = result.replace(PHONE_INTL_PATTERN, REDACTED_VALUE)
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
