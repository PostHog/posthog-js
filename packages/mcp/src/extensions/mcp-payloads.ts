// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import {
  redactPayloadPii,
  redactPii,
  sanitizeCapturedValue as sanitizeCoreCapturedValue,
  sanitizeFreeText as sanitizeCoreFreeText,
  sanitizeFreeTextValue as sanitizeCoreFreeTextValue,
  type TextSanitizationOptions,
} from '@posthog/core'
import { limitEntries, MAX_STRING_LENGTH, TRUNCATION_SUFFIX } from './truncation'

const CONTEXT_ARGUMENT_NAME = 'context'
const CAPTURED_REQUEST_FIELDS = ['id', 'jsonrpc', 'method', 'params']
const SANITIZATION_OPTIONS: TextSanitizationOptions = {
  maxStringLength: MAX_STRING_LENGTH,
  truncationSuffix: TRUNCATION_SUFFIX,
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export { redactPayloadPii, redactPii }

export function sanitizeFreeText(value: string): string {
  return sanitizeCoreFreeText(value, SANITIZATION_OPTIONS)
}

export function sanitizeCapturedValue(value: unknown, options?: Partial<TextSanitizationOptions>): unknown {
  return sanitizeCoreCapturedValue(value, { ...SANITIZATION_OPTIONS, ...options })
}

export function sanitizeFreeTextValue(value: unknown): unknown {
  return sanitizeCoreFreeTextValue(value, SANITIZATION_OPTIONS)
}

/**
 * The request as captured: its id, JSON-RPC version, method, and params, without
 * the injected `context` argument, which `$mcp_intent` carries. The entry and
 * nesting limits apply before the sanitizer reads anything, so a call with a huge
 * argument object costs what a call at those limits costs.
 */
export function buildCapturedMcpParameters(request: unknown): JsonRecord {
  const captured = limitEntries({ request: pickCapturedFields(request) }) as { request: unknown }
  omitContextArgument(captured.request)
  return sanitizeCapturedValue(captured) as JsonRecord
}

function pickCapturedFields(request: unknown): unknown {
  if (!isRecord(request)) {
    return request
  }
  return Object.fromEntries(CAPTURED_REQUEST_FIELDS.filter((key) => key in request).map((key) => [key, request[key]]))
}

function omitContextArgument(request: unknown): void {
  if (isRecord(request) && isRecord(request.params) && isRecord(request.params.arguments)) {
    delete request.params.arguments[CONTEXT_ARGUMENT_NAME]
  }
}
