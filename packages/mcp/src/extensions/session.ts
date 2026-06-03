import { version } from '../version'
import type {
  CompatibleRequestHandlerExtra,
  MCPAnalyticsData,
  MCPServerLike,
  ServerClientInfoLike,
  SessionInfo,
} from '../types'
import { INACTIVITY_TIMEOUT_IN_MINUTES } from './constants'
import { deterministicPrefixedId, newPrefixedId } from './ids'
import { getServerTrackingData, setServerTrackingData } from './internal'

export function newSessionId(): string {
  return newPrefixedId('ses')
}

/**
 * Creates a deterministic SDK session ID from an MCP sessionId.
 * The same inputs will always produce the same session ID, enabling correlation across server restarts.
 *
 * @param mcpSessionId - The session ID from the MCP protocol
 * @returns An SDK session ID with "ses" prefix derived deterministically from the inputs
 */
export function deriveSessionIdFromMCPSession(mcpSessionId: string): string {
  return deterministicPrefixedId('ses', mcpSessionId)
}

/**
 * Gets or generates a session ID for the server.
 * Prioritizes MCP protocol sessionId over PostHog MCP analytics-generated sessionId.
 *
 * @param server - The MCP server instance
 * @param extra - Optional extra data containing MCP sessionId
 * @returns The session ID to use for events
 */
export function getServerSessionId(server: MCPServerLike, extra?: CompatibleRequestHandlerExtra): string {
  const data = getServerTrackingData(server)

  if (!data) {
    throw new Error('Server tracking data not found')
  }

  const mcpSessionId = extra?.sessionId

  // If MCP sessionId is provided
  if (mcpSessionId) {
    // Derive deterministic SDK session ID from MCP sessionId
    data.sessionId = deriveSessionIdFromMCPSession(mcpSessionId)
    data.lastMcpSessionId = mcpSessionId
    data.sessionSource = 'mcp'
    setServerTrackingData(server, data)
    // If MCP sessionId hasn't changed, continue using the existing derived ID
    setLastActivity(server)
    return data.sessionId
  }

  // No MCP sessionId provided - handle PostHog MCP analytics-generated sessions
  // If we had an MCP sessionId before but it disappeared, keep using the last derived ID
  if (data.sessionSource === 'mcp' && data.lastMcpSessionId) {
    setLastActivity(server)
    return data.sessionId
  }

  // For PostHog MCP analytics-generated sessions, apply timeout logic
  const now = Date.now()
  const timeoutMs = INACTIVITY_TIMEOUT_IN_MINUTES * 60 * 1000
  // If last activity timed out
  if (now - data.lastActivity.getTime() > timeoutMs) {
    data.sessionId = newSessionId()
    data.sessionSource = 'generated'
    setServerTrackingData(server, data)
  }
  setLastActivity(server)

  return data.sessionId
}

export function setLastActivity(server: MCPServerLike): void {
  const data = getServerTrackingData(server)

  if (!data) {
    throw new Error('Server tracking data not found')
  }

  data.lastActivity = new Date()
  setServerTrackingData(server, data)
}

/**
 * Builds the session metadata stamped onto an event. The caller passes the
 * session id resolved for *this* request so identity attribution can't be
 * clobbered by a concurrent request mutating shared `data.sessionId`.
 */
export function getSessionInfo(
  server: MCPServerLike,
  data: MCPAnalyticsData | undefined,
  sessionId?: string
): SessionInfo {
  let clientInfo: ServerClientInfoLike | undefined = {
    name: undefined,
    version: undefined,
  }
  if (!data?.sessionInfo.clientName) {
    clientInfo = server.getClientVersion()
  }
  const actorInfo = data?.identifiedSessions.get(sessionId ?? data.sessionId)

  const sessionInfo: SessionInfo = {
    ipAddress: undefined, // grab from django
    sdkLanguage: 'TypeScript', // hardcoded for now
    sdkVersion: version,
    serverName: server._serverInfo?.name,
    serverVersion: server._serverInfo?.version,
    clientName: clientInfo?.name,
    clientVersion: clientInfo?.version,
    identifyActorGivenId: actorInfo?.distinctId,
    identifyActorData: actorInfo?.properties || {},
    identifyActorGroups: actorInfo?.groups,
  }

  if (!data) {
    return sessionInfo
  }

  data.sessionInfo = sessionInfo
  setServerTrackingData(server, data)
  return data.sessionInfo
}
