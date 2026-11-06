// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import {
  redactPii,
  sanitizeCapturedValue as sanitizeCoreCapturedValue,
  sanitizeFreeText as sanitizeCoreFreeText,
  sanitizeFreeTextValue as sanitizeCoreFreeTextValue,
  type TextSanitizationOptions,
} from '@posthog/core'
import { limitEntries, MAX_BREADTH, MAX_STRING_LENGTH, TRUNCATION_SUFFIX } from './truncation'

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

export { redactPii }

export function sanitizeFreeText(value: string): string {
  return sanitizeCoreFreeText(value, SANITIZATION_OPTIONS)
}

export function sanitizeCapturedValue(value: unknown): unknown {
  return sanitizeCoreCapturedValue(value, SANITIZATION_OPTIONS)
}

export function sanitizeFreeTextValue(value: unknown): unknown {
  return sanitizeCoreFreeTextValue(value, SANITIZATION_OPTIONS)
}

/**
 * The request as captured: its id, JSON-RPC version, method, and params, without
 * the injected `context` argument, which `$mcp_intent` carries. The entry and
 * nesting limits apply before sanitizing, so a call with a huge argument object
 * costs what a call at those limits costs.
 */
export function buildCapturedMcpParameters(request: unknown): JsonRecord {
  return sanitizeCapturedValue(limitEntries({ request: pickCapturedFields(request) })) as JsonRecord
}

function pickCapturedFields(request: unknown): unknown {
  if (!isRecord(request)) {
    return request
  }
  const fields = Object.fromEntries(
    CAPTURED_REQUEST_FIELDS.filter((key) => key in request).map((key) => [key, request[key]])
  )
  const { params } = fields
  if (isRecord(params) && isRecord(params.arguments)) {
    fields.params = { ...params, arguments: argumentsWithoutContext(params.arguments) }
  }
  return fields
}

/**
 * The arguments without `context`, so it does not count toward the entry limit.
 * Copies one more than the limit, enough for the limit to see that more remain.
 */
function argumentsWithoutContext(args: JsonRecord): JsonRecord {
  const kept: [string, unknown][] = []
  for (const key of Object.keys(args)) {
    if (kept.length > MAX_BREADTH) {
      break
    }
    if (key !== CONTEXT_ARGUMENT_NAME) {
      kept.push([key, args[key]])
    }
  }
  return Object.fromEntries(kept)
}
