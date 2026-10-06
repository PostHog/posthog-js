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
import { MAX_STRING_LENGTH, TRUNCATION_SUFFIX } from './truncation'

const CONTEXT_ARGUMENT_NAME = 'context'
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
