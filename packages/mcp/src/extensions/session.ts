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
 * Resolves the session id for a request. Three steps, first match wins:
 *
 *   1. the agent carried a `conversation_id` tool argument   — 2026-07-28
 *   2. the request carried a session id                      — 2025-11-25
 *   3. nothing was carried, so reuse this instance's own id  — stdio
 *
 * The split mirrors the two protocol revisions. 2026-07-28 removed protocol-level
 * sessions, so the only thing that can carry a session across calls is the agent
 * itself (1). 2025-11-25 kept the session on the connection, so the request
 * carries it (2). 3 is for stdio, where neither applies — there is no
 * HTTP request to carry anything, and no agent handle unless the host opted in.
 */
export function getSessionId(
  server: MCPServerLike,
  extra?: CompatibleRequestHandlerExtra,
  conversationId?: string
): string {
  const data = getServerTrackingData(server)
  if (!data) {
    throw new Error('Server tracking data not found')
  }

  // 1. The agent's conversation handle. It outranks both steps below because it
  // is the only id that survives reconnects, restarts, and the per-request
  // server instances the 2026-07-28 revision introduces. Hashed rather than used
  // verbatim so it can never collide with Session Replay ids.
  //
  // This returns instead of falling through to the shared-state writes at the
  // end: the handle belongs to this one request, and persisting it would leak
  // one chat's session onto a concurrent chat's `tools/list`.
  if (conversationId) {
    return deterministicPrefixedId('ses', conversationId)
  }

  // 2. A session id the request itself carried (undefined if it carried none).
  const carriedByRequest = readSessionIdFromRequest(data, extra)

  // 3. Nothing carried, so fall back to the id this instance already holds.
  const sessionId = carriedByRequest ?? getSessionIdFromMemory(data)

  // 2 and 3 are connection-scoped, so their result is remembered for the
  // next request on this instance. 1 never reaches here.
  data.sessionId = sessionId
  data.lastActivity = new Date()
  setServerTrackingData(server, data)
  return sessionId
}

/**
 * 2. The session id a request carried. Two sources, tried in order: our own token
 * on the `mcp-session-id` header, then the raw session id a stateful transport
 * issued. Returns undefined when the request carried neither, which is what
 * sends the caller on to 3.
 *
 * Both are 2025-11-25 mechanisms. The 2026-07-28 revision removed that header
 * outright — servers MUST NOT mint or echo it — so this entire step becomes
 * legacy-only once era detection lands.
 */
function readSessionIdFromRequest(data: MCPAnalyticsData, extra?: CompatibleRequestHandlerExtra): string | undefined {
  // 2a. A token we minted at `initialize` and the client replayed. It rides the
  // `mcp-session-id` header, which stateless transports don't surface as
  // extra.sessionId, so read the header ourselves. Decoding it also restores the
  // client name/version and protocol version baked in at mint time.
  const sessionHeader = readMcpSessionHeader(extra?.requestInfo?.headers)
  const token = decodeSessionId(sessionHeader)
  if (token) {
    data.sessionSource = 'token'
    data.sessionInfo.clientName = token.clientName
    data.sessionInfo.clientVersion = token.clientVersion
    data.sessionInfo.protocolVersion = token.protocolVersion
    return token.sessionId
  }

  // 2b. No token, but a stateful transport issued its own session id. Hash it so
  // the same MCP session maps to the same SDK session across restarts.
  if (extra?.sessionId) {
    data.sessionSource = 'mcp'
    return deriveSessionIdFromMCPSession(extra.sessionId)
  }

  return undefined
}

/**
 * 3. The request carried nothing, so keep the id this instance already holds —
 * minted once at `instrument()`. This is what groups a stdio server's calls,
 * where there is no header and no transport session to read.
 *
 * Only self-generated ids roll over on inactivity. Token and transport ids live
 * as long as the client replays them, so regenerating one would split a session
 * that is still very much alive.
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
    // No SDK getter for this (unlike getClientVersion) — the MCP SDK never
    // retains the negotiated version, so it lives only where we stored it.
    protocolVersion: data?.sessionInfo.protocolVersion,
    identifyActorGivenId: actorInfo?.distinctId,
    identifyActorData: actorInfo?.properties || {},
    identifyActorGroups: actorInfo?.groups,
  }

  if (!data) {
    return sessionInfo
  }

  data.sessionInfo = sessionInfo
  setServerTrackingData(server, data)
  return { ...sessionInfo }
}
