// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import { ErrorTracking as CoreErrorTracking } from '@posthog/core'

/**
 * Builds PostHog error-tracking properties (`$exception_list`) from arbitrary
 * thrown values, reusing `@posthog/core`'s shared coercers + stack parser
 * instead of a bespoke V8 parser. Mirrors how `posthog-node` constructs its
 * builder, minus the Node-only frame modifiers (source context, relative
 * paths) which live in the `posthog-node` package and require async fs access.
 */
const errorPropertiesBuilder = new CoreErrorTracking.ErrorPropertiesBuilder(
  [
    new CoreErrorTracking.EventCoercer(),
    new CoreErrorTracking.ErrorCoercer(),
    new CoreErrorTracking.ObjectCoercer(),
    new CoreErrorTracking.StringCoercer(),
    new CoreErrorTracking.PrimitiveCoercer(),
  ],
  CoreErrorTracking.createStackParser('node:javascript', CoreErrorTracking.nodeStackLineParser)
)

interface CallToolContentPart {
  text?: unknown
  type?: unknown
}

interface CallToolResult {
  content: unknown[]
  isError: unknown
}

/**
 * Captures structured exception properties from any thrown value.
 *
 * Returns the `$exception_list` shape PostHog error tracking expects, so MCP
 * tool failures group and (with uploaded source maps) symbolicate the same way
 * as exceptions from any other PostHog SDK.
 *
 * @param error - The thrown value (Error, string, object, CallToolResult, or anything).
 * @returns Core `ErrorProperties` ready to spread onto a `$exception` event.
 */
export function captureException(error: unknown): CoreErrorTracking.ErrorProperties {
  // MCP SDK 1.21.0+ converts tool errors to CallToolResult, which the core
  // coercers don't recognize. Extract the human-readable message first so the
  // exception still carries something useful.
  try {
    const normalized = isCallToolResult(error) ? extractCallToolResultMessage(error) : error
    return errorPropertiesBuilder.buildFromUnknown(normalized)
  } catch {
    // A thrown value can carry getters that throw; the failure still gets recorded.
    return errorPropertiesBuilder.buildFromUnknown('Unknown error')
  }
}

const STATUS_FIELDS = ['status_code', 'statusCode', 'status']
const MAX_CHAIN_LINKS = 50

/**
 * The HTTP status behind a failure, for `$mcp_error_status`: the first one found
 * walking the thrown error's `cause` chain inward, so a status the tool threw
 * itself beats the one on the error it wrapped. Reads each link and its
 * `response` (a fetch `Response`, an axios or got response).
 */
export function httpStatus(error: unknown): number | undefined {
  const visited = new Set<unknown>()
  for (
    let link = error;
    isObject(link) && !visited.has(link) && visited.size < MAX_CHAIN_LINKS;
    link = readField(link, 'cause')
  ) {
    visited.add(link)
    for (const holder of [link, readField(link, 'response')]) {
      for (const field of STATUS_FIELDS) {
        const status = readField(holder, field)
        if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
          return status
        }
      }
    }
  }
  return undefined
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object'
}

function readField(value: unknown, field: string): unknown {
  // A third-party getter can throw; a failed probe must not drop the event.
  try {
    return isObject(value) ? (value as Record<string, unknown>)[field] : undefined
  } catch {
    return undefined
  }
}

/**
 * Detects a CallToolResult error object (SDK 1.21.0+ format):
 * `{ content: [{ type: "text", text: "..." }], isError: true }`.
 */
function isCallToolResult(value: unknown): value is CallToolResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'isError' in value &&
    'content' in value &&
    Array.isArray((value as { content?: unknown }).content)
  )
}

function isTextContentPart(value: unknown): value is { text: string } {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const contentPart = value as CallToolContentPart
  return contentPart.type === 'text' && typeof contentPart.text === 'string'
}

/**
 * Extracts the concatenated text from a CallToolResult's content array.
 * The SDK strips the original Error, so only the message survives.
 */
function extractCallToolResultMessage(result: CallToolResult): string {
  return (
    result.content
      .filter(isTextContentPart)
      .map((contentPart) => contentPart.text)
      .join(' ')
      .trim() || 'Unknown error'
  )
}
