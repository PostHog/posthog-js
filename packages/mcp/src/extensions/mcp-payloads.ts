// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

const CONTEXT_ARGUMENT_NAME = 'context'
const REDACTED_VALUE = '[redacted]'
const BASE64_PATTERN = /^[A-Za-z0-9+/\n\r]+=*$/
const SIZE_GATE = 10_240
const POSTHOG_TOKEN_PATTERN = /\bph[a-z]_[A-Za-z0-9_-]{20,}\b/g
const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|api[-_]?token|access[-_]?token|refresh[-_]?token|token|password|secret|client[-_]?secret|private[-_]?key)$/i

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

function sanitizeString(value: string): string {
  if (value.length >= SIZE_GATE && BASE64_PATTERN.test(value)) {
    return '[binary data redacted - not supported by PostHog MCP analytics]'
  }
  return value.replace(POSTHOG_TOKEN_PATTERN, REDACTED_VALUE)
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
