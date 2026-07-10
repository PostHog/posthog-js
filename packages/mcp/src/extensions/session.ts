// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

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
 * Derives the SDK session id deterministically from the MCP sessionId, so the
 * same MCP session correlates to one SDK session across server restarts.
 */
export function deriveSessionIdFromMCPSession(mcpSessionId: string): string {
  return deterministicPrefixedId('ses', mcpSessionId)
}

/**
 * Resolves the session id for a request, preferring the MCP protocol sessionId
 * over an SDK-generated one so a transport-supplied session wins.
 */
export function getServerSessionId(server: MCPServerLike, extra?: CompatibleRequestHandlerExtra): string {
  const data = getServerTrackingData(server)

  if (!data) {
    throw new Error('Server tracking data not found')
  }

  const mcpSessionId = extra?.sessionId

  if (mcpSessionId) {
    data.sessionId = deriveSessionIdFromMCPSession(mcpSessionId)
    data.lastMcpSessionId = mcpSessionId
    data.sessionSource = 'mcp'
    setServerTrackingData(server, data)
    setLastActivity(server)
    return data.sessionId
  }

  // Once a session has been MCP-derived, keep that id even if a later request
  // arrives without the MCP sessionId, so the session doesn't fragment.
  if (data.sessionSource === 'mcp' && data.lastMcpSessionId) {
    setLastActivity(server)
    return data.sessionId
  }

  // SDK-generated sessions roll over after an inactivity timeout.
  const now = Date.now()
  const timeoutMs = INACTIVITY_TIMEOUT_IN_MINUTES * 60 * 1000
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
  let clientInfo: ServerClientInfoLike | undefined
  if (data?.sessionInfo.clientName) {
    clientInfo = {
      name: data.sessionInfo.clientName,
      version: data.sessionInfo.clientVersion,
    }
  } else {
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
