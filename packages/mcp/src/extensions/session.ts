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
import { decodeSessionId, readMcpSessionHeader } from './session-token'

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
 * Resolves the session id for a request: from the replayed session token, from
 * the transport's MCP session id, or — when the request carries nothing — from
 * this instance's memory. Also saves the token's client name/version so events
 * built later in the request can use them (see getSessionInfo).
 */
export function getSessionId(server: MCPServerLike, extra?: CompatibleRequestHandlerExtra): string {
  const data = getServerTrackingData(server)
  if (!data) {
    throw new Error('Server tracking data not found')
  }

  // Our token rides the `mcp-session-id` request header, which stateless
  // transports ignore — so read it ourselves.
  const sessionHeader = readMcpSessionHeader(extra?.requestInfo?.headers)
  const token = decodeSessionId(sessionHeader)

  let sessionId: string
  if (token) {
    // Token we minted at `initialize` (see session-token.ts).
    data.sessionSource = 'token'
    data.sessionInfo.clientName = token.clientName
    data.sessionInfo.clientVersion = token.clientVersion
    sessionId = token.sessionId
  } else if (extra?.sessionId) {
    // Session id issued by a stateful transport: hash it so the same MCP
    // session maps to the same SDK session across restarts.
    data.sessionSource = 'mcp'
    sessionId = deriveSessionIdFromMCPSession(extra.sessionId)
  } else {
    sessionId = getSessionIdFromMemory(data)
  }

  data.sessionId = sessionId
  data.lastActivity = new Date()
  setServerTrackingData(server, data)
  return sessionId
}

/**
 * Nothing replayed on this request: keep the id we already have. Only
 * generated sessions roll over on inactivity — token/MCP ids live as long as
 * the client replays them, and regenerating one would split the session.
 */
function getSessionIdFromMemory(data: MCPAnalyticsData): string {
  const timeoutMs = INACTIVITY_TIMEOUT_IN_MINUTES * 60 * 1000
  const isStale = Date.now() - data.lastActivity.getTime() > timeoutMs
  if (data.sessionSource === 'generated' && isStale) {
    return newSessionId()
  }
  return data.sessionId
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
