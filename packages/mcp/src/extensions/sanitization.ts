// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import type { ErrorProperties, Event, McpEvent } from '../types'
import { sanitizeCapturedValue, sanitizeFreeText } from './mcp-payloads'

type SanitizedRecord = Record<string, unknown>

function isRecord(value: unknown): value is SanitizedRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Sanitizes an event by redacting non-text content blocks from responses
 * and large base64-encoded strings from parameters, and applying the same
 * string redaction (PostHog tokens, base64 blobs, sensitive keys) to values
 * supplied by the agent.
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

  // Every event type, not just `resources/read`: `$identify` and the `$exception`
  // sibling carry the same name, and a tool or prompt name is free text an
  // application can spell as a URL too.
  if (result.resourceName != null) {
    result.resourceName = sanitizeCapturedValue(result.resourceName) as string
  }

  // The intent comes straight from an agent-narrated `context` string, so it can
  // contain a secret the LLM read aloud or personal data it narrated about the
  // user. `sanitizeFreeText` adds structured PII redaction (emails, phone numbers,
  // IPs, cards, SSNs) to the passes every captured value gets, in the one order
  // that works — see its doc comment. PII redaction is scoped to the intent only:
  // structured tool parameters and responses often hold the same shapes as
  // legitimate data.
  if (result.userIntent != null) {
    result.userIntent = sanitizeFreeText(result.userIntent)
  }

  if (result.llmModel != null) {
    result.llmModel = sanitizeCapturedValue(result.llmModel) as string
  }

  if (result.error != null) {
    result.error = sanitizeExceptionValues(result.error)
  }

  return result
}

/**
 * Sanitizes exception messages before they fan out to both the primary MCP
 * event's error-message property and the `$exception` sibling.
 */
function sanitizeExceptionValues(error: ErrorProperties): ErrorProperties {
  if (!Array.isArray(error.$exception_list)) {
    return error
  }

  return {
    ...error,
    $exception_list: error.$exception_list.map((exception) => ({
      ...exception,
      value: sanitizeCapturedValue(exception.value) as string,
    })),
  }
}

/**
 * Sanitizes response content blocks by replacing non-text content types
 * with informative redaction messages.
 */
function sanitizeResponse(response: unknown): unknown {
  // Replace the unsupported blocks before the one sanitize pass, so it never scans their data.
  if (isRecord(response) && Array.isArray(response.content)) {
    return sanitizeCapturedValue({ ...response, content: response.content.map(sanitizeContentBlock) })
  }
  return sanitizeCapturedValue(response)
}

/**
 * Sanitizes a single content block based on its type discriminator.
 */
function sanitizeContentBlock(block: unknown): unknown {
  if (!isRecord(block)) {
    return block
  }

  switch (block.type) {
    case 'text':
    case 'resource_link':
      return block

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
  return block
}

/**
 * Recursively scans parameters for large base64-encoded strings and replaces them.
 * Uses a size gate (10KB) to avoid regex testing on small strings.
 */
function sanitizeParameters(obj: unknown): unknown {
  return sanitizeCapturedValue(obj)
}
