import type { CompatibleRequestHandlerExtra, MCPAnalyticsData, MCPRequestLike, UnredactedEvent } from '../types'
import { resolveEventProperties } from './internal'

/**
 * Helpers shared by the low-level (`tracing.ts`) and high-level (`tracing-v2.ts`)
 * MCP server wrappers. Extracted so both paths stay in sync — any change to
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
  event: UnredactedEvent,
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
export function getEventDuration(event: UnredactedEvent): number {
  return event.timestamp ? Date.now() - event.timestamp.getTime() : 0
}
