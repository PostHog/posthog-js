// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type { Event, McpEvent } from '../types'
import { sanitizeCapturedValue } from './mcp-payloads'

type SanitizedRecord = Record<string, unknown>

function isRecord(value: unknown): value is SanitizedRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Sanitizes an event by redacting non-text content blocks from responses
 * and large base64-encoded strings from parameters, and applying the same
 * string redaction (PostHog tokens, base64 blobs, sensitive keys) to the
 * agent-supplied intent.
 *
 * This is a synchronous operation that returns a new object without mutating the original.
 * It should run after customer redaction in the event pipeline.
 */
export function sanitizeEvent<T extends Event | McpEvent>(event: T): T {
  const result = { ...event }

  if (result.response != null) {
    result.response = sanitizeResponse(result.response)
  }

  if (result.parameters != null) {
    result.parameters = sanitizeParameters(result.parameters)
  }

  // The intent comes straight from an agent-narrated `context` string, so it
  // can contain a secret the LLM read aloud. Redact it like any other captured
  // value rather than shipping it raw as `$mcp_intent`.
  if (result.userIntent != null) {
    result.userIntent = sanitizeCapturedValue(result.userIntent) as string
  }

  return result
}

/**
 * Sanitizes response content blocks by replacing non-text content types
 * with informative redaction messages.
 */
function sanitizeResponse(response: unknown): unknown {
  if (response == null || typeof response !== 'object') {
    return sanitizeCapturedValue(response)
  }

  const sanitized = sanitizeCapturedValue(response)
  if (!isRecord(sanitized)) {
    return sanitized
  }

  const result: SanitizedRecord = { ...sanitized }
  const content = result.content
  if (Array.isArray(content)) {
    result.content = content.map(sanitizeContentBlock)
  }

  if (result.structuredContent != null && typeof result.structuredContent === 'object') {
    result.structuredContent = sanitizeCapturedValue(result.structuredContent)
  }

  return result
}

/**
 * Sanitizes a single content block based on its type discriminator.
 */
function sanitizeContentBlock(block: unknown): unknown {
  if (block == null || typeof block !== 'object') {
    return block
  }

  if (!isRecord(block)) {
    return block
  }

  switch (block.type) {
    case 'text':
      return sanitizeCapturedValue(block)

    case 'image':
      return {
        type: 'text',
        text: '[image content redacted - not supported by PostHog MCP analytics]',
      }

    case 'audio':
      return {
        type: 'text',
        text: '[audio content redacted - not supported by PostHog MCP analytics]',
      }

    case 'resource':
      return sanitizeResourceBlock(block)

    case 'resource_link':
      return sanitizeCapturedValue(block)

    default:
      return {
        type: 'text',
        text: `[unsupported content type "${block.type}" redacted - not supported by PostHog MCP analytics]`,
      }
  }
}

/**
 * Sanitizes an embedded resource content block.
 * BlobResourceContents (has `blob` field) are redacted.
 * TextResourceContents (has `text` field) pass through.
 */
function sanitizeResourceBlock(block: SanitizedRecord): unknown {
  if (isRecord(block.resource) && 'blob' in block.resource) {
    return {
      type: 'text',
      text: '[binary resource content redacted - not supported by PostHog MCP analytics]',
    }
  }
  return sanitizeCapturedValue(block)
}

/**
 * Recursively scans parameters for large base64-encoded strings and replaces them.
 * Uses a size gate (10KB) to avoid regex testing on small strings.
 */
function sanitizeParameters(obj: unknown): unknown {
  return sanitizeCapturedValue(obj)
}
