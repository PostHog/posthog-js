// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

import type { CompatibleRequestHandlerExtra, MCPAnalyticsData, MCPRequestLike, McpEvent } from '../types'
import { resolveEventProperties } from './internal'

/**
 * Helpers shared by the low-level (`instrument-lowlevel.ts`) and high-level
 * (`instrument-highlevel.ts`) MCP server wrappers. Extracted so both paths stay in sync — any change to
 * "what counts as an error result", "how do we resolve customer event
 * properties", "where do we find the context argument", or "how do we measure
 * duration" needs to land in one place.
 */

/**
 * MCP tool results signal errors by setting `isError: true` on the result
 * object rather than throwing. Detect that consistently.
 */
export function isToolResultError(result: unknown): boolean {
  return !!result && typeof result === 'object' && 'isError' in result && result.isError === true
}

/**
 * Resolves the `eventProperties` callback (if configured) and stamps the
 * result onto the event. No-op when the callback is absent or returns nullish.
 */
export async function applyResolvedMetadata(
  event: McpEvent,
  data: MCPAnalyticsData,
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra
): Promise<void> {
  const resolvedProperties = await resolveEventProperties(data, request, extra)
  if (resolvedProperties) {
    event.properties = resolvedProperties
  }
}

/**
 * Reads the SDK-injected `context` argument off a tool-call request. Returns
 * the trimmed string when present, otherwise `undefined`.
 */
export function getContextArgument(request: MCPRequestLike): string | undefined {
  const context = request.params?.arguments?.context
  return typeof context === 'string' ? context : undefined
}

/**
 * Wall-clock duration of a tracked operation in milliseconds, from `event.timestamp`
 * to now. Returns `0` when timestamp is missing so callers don't have to null-check.
 */
export function getEventDuration(event: McpEvent): number {
  return event.timestamp ? Date.now() - event.timestamp.getTime() : 0
}
