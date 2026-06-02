import { isCompatibleServerType, isHighLevelServer } from './extensions/compatibility'
import { McpEventSink } from './extensions/sink'
import { MCPAnalyticsEventType } from './extensions/event-types'
import { captureException } from './extensions/exceptions'
import { getServerTrackingData, setServerTrackingData } from './extensions/internal'
import { log, setLogger } from './extensions/logger'
import { captureEvent } from './extensions/capture'
import { deriveSessionIdFromMCPSession, getSessionInfo, newSessionId } from './extensions/session'
import { setupMCPAnalyticsTools } from './extensions/tools'
import { setupToolCallTracing } from './extensions/tracing'
import { setupTracking } from './extensions/tracing-v2'
import type {
  CustomEventData,
  HighLevelMCPServerLike,
  MCPAnalyticsData,
  MCPAnalyticsOptions,
  MCPServerLike,
  UnredactedEvent,
  UserIdentity,
} from './types'

/**
 * Instruments an MCP server so PostHog auto-captures tool calls, tool listings, initialize
 * requests, identity, and exceptions.
 *
 * **Idempotent per server instance.** We store per-server tracking state in a
 * module-level `WeakMap<MCPServerLike, MCPAnalyticsData>` (`internal.ts`). A
 * second `instrument()` call on the same server checks that map, logs, and
 * returns early, so handlers are never double-wrapped and events are never
 * duplicated.
 *
 * @param server - The MCP server instance to instrument (low-level `Server` or high-level `McpServer`).
 * @param options - Configuration. See `MCPAnalyticsOptions`.
 * @returns The same server instance, typed.
 *
 * @example
 * ```ts
 * import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
 * import { instrument } from "@posthog/mcp"
 *
 * const server = new McpServer({ name: "my-mcp", version: "1.0.0" })
 * instrument(server, { projectToken: "phc_..." })
 * ```
 */
function instrument<TServer>(server: TServer, options: MCPAnalyticsOptions = {}): TServer {
  try {
    if (options.logger) {
      setLogger(options.logger)
    }

    const validatedServer = isCompatibleServerType(server)
    const lowLevelServer = getLowLevelServer(validatedServer)

    const existingData = getServerTrackingData(lowLevelServer)
    if (existingData) {
      log('instrument() - Server already instrumented, skipping initialization')
      return validatedServer as TServer
    }

    const sink = options.posthog ? new McpEventSink(options.posthog) : undefined
    if (!sink) {
      log('Warning: No PostHog client provided (`posthog` option). Events will not be sent anywhere.')
    }

    const mcpAnalyticsData = buildTrackingData(lowLevelServer, options, sink)

    setServerTrackingData(lowLevelServer, mcpAnalyticsData)
    setupTrackedServer(validatedServer, lowLevelServer, mcpAnalyticsData)

    return validatedServer as TServer
  } catch (error) {
    log(`Warning: Failed to instrument server - ${error}`)
    return server
  }
}

function getLowLevelServer(server: MCPServerLike | HighLevelMCPServerLike): MCPServerLike {
  return isHighLevelServer(server) ? (server as HighLevelMCPServerLike).server : (server as MCPServerLike)
}

function buildTrackingData(
  lowLevelServer: MCPServerLike,
  options: MCPAnalyticsOptions,
  sink: McpEventSink | undefined
): MCPAnalyticsData {
  return {
    sink,
    sessionId: newSessionId(),
    lastActivity: new Date(),
    identifiedSessions: new Map<string, UserIdentity>(),
    toolDescriptions: new Map<string, string>(),
    sessionInfo: getSessionInfo(lowLevelServer, undefined),
    options: {
      reportMissing: options.reportMissing ?? false,
      enableAITracing: options.enableAITracing ?? false,
      enableTracing: options.enableTracing ?? true,
      enableConversationId: options.enableConversationId ?? false,
      context: options.context,
      intentFallback: options.intentFallback,
      identify: options.identify,
      redactSensitiveInformation: options.redactSensitiveInformation,
      eventProperties: options.eventProperties,
      logger: options.logger,
    },
    sessionSource: 'generated',
  }
}

function setupTrackedServer(
  validatedServer: MCPServerLike | HighLevelMCPServerLike,
  lowLevelServer: MCPServerLike,
  mcpAnalyticsData: MCPAnalyticsData
): void {
  if (isHighLevelServer(validatedServer)) {
    const highLevelServer = validatedServer as HighLevelMCPServerLike
    setupTracking(highLevelServer)
    return
  }

  if (mcpAnalyticsData.options.reportMissing) {
    try {
      setupMCPAnalyticsTools(lowLevelServer)
    } catch (error) {
      log(`Warning: Failed to setup report missing tool - ${error}`)
    }
  }

  if (mcpAnalyticsData.options.enableTracing) {
    try {
      setupToolCallTracing(lowLevelServer)
    } catch (error) {
      log(`Warning: Failed to setup tool call tracing - ${error}`)
    }
  }
}

/**
 * Publishes a custom `$mcp_custom` event for an instrumented server. Use this to record
 * domain-specific actions that aren't captured automatically (e.g. user feedback, app-level
 * state changes). The server must already have been passed to `instrument()`.
 */
export function publishCustomEvent(server: unknown, eventData: CustomEventData = {}): Promise<void> {
  try {
    publishCustomEventSync(server, eventData)
    return Promise.resolve()
  } catch (error) {
    return Promise.reject(error)
  }
}

function publishCustomEventSync(serverInput: unknown, eventData: CustomEventData): void {
  if (!serverInput || typeof serverInput !== 'object') {
    throw new Error('First argument must be an instrumented MCP server instance')
  }

  const lowLevelServer = getLowLevelServerFromUnknownObject(serverInput)
  const trackingData = getServerTrackingData(lowLevelServer)
  if (!trackingData) {
    throw new Error('Server is not instrumented. Call `instrument(server, options)` before `publishCustomEvent`.')
  }

  const event: UnredactedEvent = {
    sessionId: trackingData.sessionId,
    eventType: MCPAnalyticsEventType.custom,
    timestamp: new Date(),
    resourceName: eventData.resourceName,
    parameters: eventData.parameters,
    response: eventData.response,
    userIntent: eventData.message,
    duration: eventData.duration,
    isError: eventData.isError,
    error: resolveCustomEventError(eventData.error),
    redactionFn: trackingData.options.redactSensitiveInformation,
  }

  if (eventData.properties && Object.keys(eventData.properties).length > 0) {
    event.properties = eventData.properties
  }

  // Re-use the same per-server publish path so the event picks up session info,
  // identity, sdk metadata, etc.
  captureEvent(lowLevelServer, event)
  log(`Published custom event for session ${trackingData.sessionId}`)
}

function resolveCustomEventError(error: unknown): UnredactedEvent['error'] {
  if (error === undefined || error === null) {
    return error
  }

  // Everything else (Error, string, object with `message`, etc.) is normalized
  // by the core coercers into the `$exception_list` shape.
  return captureException(error)
}

function getLowLevelServerFromUnknownObject(server: object): MCPServerLike {
  return 'server' in server && server.server && typeof server.server === 'object'
    ? (server.server as MCPServerLike)
    : (server as MCPServerLike)
}

export { deriveSessionIdFromMCPSession }
export {
  POSTHOG_MCP_ANALYTICS_SOURCE,
  PostHogMCPAnalyticsEvent,
  PostHogMCPAnalyticsProperty,
} from './extensions/constants'
export type {
  CustomEventData,
  MCPAnalyticsContextOptions,
  MCPAnalyticsIntentSource,
  MCPAnalyticsOptions,
  RedactFunction,
  UserIdentity,
} from './types'
export type IdentifyFunction = MCPAnalyticsOptions['identify']
export { instrument }
