// Portions of this file are derived from MCPCat/mcpcat-typescript-sdk
// Copyright (c) 2025 MCPcat
// Licensed under the MIT License: https://github.com/MCPCat/mcpcat-typescript-sdk/blob/main/LICENSE

import type { PostHog } from 'posthog-node'
import { isCompatibleServerType, isHighLevelServer } from './extensions/compatibility'
import { McpEventSink } from './extensions/sink'
import { MCPAnalyticsEventType } from './extensions/event-types'
import { IdentityCache, getServerTrackingData, setServerTrackingData } from './extensions/internal'
import { log, setLogger } from './extensions/logger'
import { captureEvent } from './extensions/capture'
import { deriveSessionIdFromMCPSession, getSessionInfo, newSessionId } from './extensions/session'
import { instrumentLowLevelServer } from './extensions/instrument-lowlevel'
import { instrumentHighLevelServer } from './extensions/instrument-highlevel'
import type {
  CaptureEventData,
  HighLevelMCPServerLike,
  McpAnalytics,
  MCPAnalyticsData,
  MCPAnalyticsOptions,
  MCPServerLike,
  McpEvent,
} from './types'

/**
 * Instruments an MCP server so PostHog auto-captures tool calls, tool listings, initialize
 * requests, identity, and exceptions. Returns a handle whose `capture()` method records
 * custom events, so you don't pass the server around after wiring it up.
 *
 * **Idempotent per server instance.** Per-server tracking state lives in a module-level
 * `WeakMap<MCPServerLike, MCPAnalyticsData>` (`internal.ts`); a second `instrument()` call
 * on the same server reuses it rather than double-wrapping handlers.
 *
 * @param server - The MCP server to instrument (low-level `Server` or high-level `McpServer`).
 * @param posthog - A `posthog-node` client you construct and own (matching `@posthog/ai`); call `posthog.shutdown()` on exit to flush.
 * @param options - Optional configuration. See `MCPAnalyticsOptions`.
 *
 * @example
 * ```ts
 * import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
 * import { PostHog } from "posthog-node"
 * import { instrument } from "@posthog/mcp"
 *
 * const posthog = new PostHog(process.env.POSTHOG_PROJECT_TOKEN, { host: "https://us.i.posthog.com" })
 * const server = new McpServer({ name: "my-mcp", version: "1.0.0" })
 * const analytics = instrument(server, posthog)
 *
 * await analytics.capture({ event: "feedback_submitted", properties: { rating: 5 } })
 * ```
 */
function instrument(server: unknown, posthog: PostHog, options: MCPAnalyticsOptions = {}): McpAnalytics {
  try {
    if (options.logger) {
      setLogger(options.logger)
    }
    if (!posthog) {
      log('Warning: No PostHog client passed to instrument(). Events will not be sent anywhere.')
    }

    const validatedServer = isCompatibleServerType(server)
    const lowLevelServer = getLowLevelServer(validatedServer)

    if (getServerTrackingData(lowLevelServer)) {
      log('instrument() - Server already instrumented, skipping initialization')
      return createAnalyticsHandle(lowLevelServer)
    }

    const sink = posthog ? new McpEventSink(posthog) : undefined
    const mcpAnalyticsData = buildTrackingData(lowLevelServer, options, sink)

    setServerTrackingData(lowLevelServer, mcpAnalyticsData)
    setupTrackedServer(validatedServer, lowLevelServer)

    return createAnalyticsHandle(lowLevelServer)
  } catch (error) {
    log(`Warning: Failed to instrument server - ${error}`)
    // Degrade gracefully: a no-op handle so the host app keeps working.
    return { capture: async () => undefined }
  }
}

function createAnalyticsHandle(lowLevelServer: MCPServerLike): McpAnalytics {
  return {
    capture: (eventData) => captureCustomEvent(lowLevelServer, eventData),
  }
}

function getLowLevelServer(server: MCPServerLike | HighLevelMCPServerLike): MCPServerLike {
  return isHighLevelServer(server) ? (server as HighLevelMCPServerLike).server : (server as MCPServerLike)
}

/**
 * Defaults for the boolean toggles. User options are spread over these, so the
 * resolved config is the single source of truth — adding a new option can never
 * be silently dropped by a hand-maintained field list (the bug that left
 * `enableExceptionAutocapture` dead). Options without a meaningful default (e.g.
 * `enableExceptionAutocapture`) are left to their read-site fallbacks.
 */
const DEFAULT_OPTIONS = {
  reportMissing: false,
  enableConversationId: false,
} satisfies Partial<MCPAnalyticsOptions>

function buildTrackingData(
  lowLevelServer: MCPServerLike,
  options: MCPAnalyticsOptions,
  sink: McpEventSink | undefined
): MCPAnalyticsData {
  return {
    sink,
    sessionId: newSessionId(),
    lastActivity: new Date(),
    identifiedSessions: new IdentityCache(),
    toolCategories: new Map<string, string>(),
    toolDescriptions: new Map<string, string>(),
    sessionInfo: getSessionInfo(lowLevelServer, undefined),
    options: { ...DEFAULT_OPTIONS, ...options },
    sessionSource: 'generated',
  }
}

function setupTrackedServer(
  validatedServer: MCPServerLike | HighLevelMCPServerLike,
  lowLevelServer: MCPServerLike
): void {
  if (isHighLevelServer(validatedServer)) {
    const highLevelServer = validatedServer as HighLevelMCPServerLike
    instrumentHighLevelServer(highLevelServer)
    return
  }

  try {
    instrumentLowLevelServer(lowLevelServer)
  } catch (error) {
    log(`Warning: Failed to setup tool call instrumentation - ${error}`)
  }
}

async function captureCustomEvent(lowLevelServer: MCPServerLike, eventData: CaptureEventData): Promise<void> {
  if (!eventData || typeof eventData.event !== 'string' || eventData.event.length === 0) {
    throw new Error('`capture` requires an `event` name, e.g. analytics.capture({ event: "feedback_submitted" })')
  }

  const trackingData = getServerTrackingData(lowLevelServer)
  if (!trackingData) {
    return
  }

  const event: McpEvent = {
    sessionId: trackingData.sessionId,
    eventType: MCPAnalyticsEventType.custom,
    eventName: eventData.event,
    timestamp: new Date(),
    properties: eventData.properties,
  }

  // Re-use the same per-server publish path so the event picks up session info,
  // identity, sdk metadata, etc. Awaited so callers know the event was processed.
  await captureEvent(lowLevelServer, event)
  log(`Captured event "${eventData.event}" for session ${trackingData.sessionId}`)
}

export { deriveSessionIdFromMCPSession }
export {
  POSTHOG_MCP_ANALYTICS_SOURCE,
  PostHogMCPAnalyticsEvent,
  PostHogMCPAnalyticsProperty,
} from './extensions/constants'
export { PostHogMCP } from './extensions/posthog-mcp'
export type {
  BeforeSendFn,
  CaptureEventData,
  InitializeCaptureData,
  McpAnalytics,
  McpCaptureCommon,
  MCPAnalyticsContextOptions,
  MCPAnalyticsIntentSource,
  MCPAnalyticsOptions,
  ToolCallCaptureData,
  UserIdentity,
} from './types'
export type IdentifyFunction = MCPAnalyticsOptions['identify']
export { instrument }
