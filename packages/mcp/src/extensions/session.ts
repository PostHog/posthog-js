// Portions of this file are derived from agentcathq/agentcat-typescript-sdk
// (formerly MCPCat/mcpcat-typescript-sdk)
// Copyright (c) 2025 AgentCat, Inc. (formerly MCPcat)
// Licensed under the MIT License: https://github.com/agentcathq/agentcat-typescript-sdk/blob/main/LICENSE

import { version } from '../version'
import type {
  CompatibleRequestHandlerExtra,
  MCPAnalyticsData,
  MCPRequestLike,
  MCPAnalyticsSessionSource,
  MCPServerLike,
  ServerClientInfoLike,
  SessionInfo,
} from '../types'
import { INACTIVITY_TIMEOUT_IN_MINUTES } from './constants'
import { deterministicPrefixedId, newPrefixedId } from './ids'
import { deriveSessionIdFromClientConversation } from './client-conversation'
import type { ClientConversation } from './client-conversation'
import { resolveClientIdentity } from './client-identity'
import { getServerTrackingData, setServerTrackingData } from './internal'
import { getRequestHeaders } from './request-headers'
import { decodeSessionId, readMcpSessionHeader } from './session-token'
import type { SessionTokenPayload } from './session-token'

/**
 * The revision that removed protocol-level sessions. A request declaring this or
 * anything later must not be answered with an `Mcp-Session-Id`.
 *
 * Compared as a string, which is safe and stable because MCP revisions are
 * ISO dates: any future revision sorts above this one and is treated as modern,
 * which is the right default — sessions were removed, not re-added.
 */
export const MODERN_PROTOCOL_REVISION = '2026-07-28'

/**
 * Revisions are ISO dates, and only a date-shaped token may be compared as one.
 * Without this the comparison is lexicographic over arbitrary input, so any
 * string starting above `'2'` — every junk value beginning with a letter —
 * sorts as modern and silently loses the session header. Unknown must mean
 * legacy, so anything that is not a date is not compared at all.
 */
const REVISION_SHAPE = /^\d{4}-\d{2}-\d{2}$/

/** The spec's rolling draft sits ahead of every dated revision, sessions included. */
const DRAFT_REVISION = 'draft'

/**
 * Whether *this request* is governed by 2026-07-28 or later.
 *
 * Era is a property of the request, never of the installed SDK: one v2 server
 * serves both, request by request, and v2's exported `LATEST_PROTOCOL_VERSION`
 * still reads `2025-11-25`. So the version is resolved from the request itself —
 * an `initialize` body declares the version it is asking for, and every other
 * request carries it in the envelope, `_meta`, or the `MCP-Protocol-Version`
 * header — and only then compared.
 *
 * Unknown means legacy. A request that declares nothing is a v1 client on a
 * transport that has always had a session header, and taking it away from them
 * would be the regression.
 */
export function isModernEraRequest(
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra,
  server?: MCPServerLike
): boolean {
  const requested = request.params?.protocolVersion
  const version =
    (typeof requested === 'string' && requested.length > 0 ? requested : undefined) ??
    resolveClientIdentity({ request, extra, server })?.protocolVersion
  if (!version) {
    return false
  }
  if (version === DRAFT_REVISION) {
    return true
  }
  return REVISION_SHAPE.test(version) && version >= MODERN_PROTOCOL_REVISION
}

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
 * Derives the SDK session id from the agent's conversation handle (ADR-0004).
 * Deterministic and unsalted on purpose: two pods that never met must agree on
 * the session, and the 2026-07-28 revision leaves them no shared state to agree
 * through.
 *
 * Hashed rather than used verbatim so an MCP session can never collide with a
 * Session Replay id — a bare uuidv7 would render a "View recording" button that
 * resolves to nothing.
 *
 * Exported because this *is* the cross-SDK contract: posthog-python has to
 * reproduce it byte for byte or the same conversation splits into two sessions
 * depending on which SDK served the call.
 */
export function deriveSessionIdFromConversation(conversationId: string): string {
  return deterministicPrefixedId('ses', conversationId)
}

export interface ResolvedSession {
  sessionId: string
  source: MCPAnalyticsSessionSource
}

/**
 * Resolves the session for a request. Four steps, first match wins:
 *
 *   1. the client named the conversation in `_meta`          — a tool call
 *   2. the agent carried a `conversation_id` tool argument   — 2026-07-28
 *   3. the request carried a session id                      — 2025-11-25
 *   4. nothing was carried, so reuse this instance's own id  — stdio
 *
 * A client that names its conversation (1) sends that id on every call, while a
 * handle (2) groups calls only while the agent copies it into each one, so the
 * client's id wins. 2026-07-28 removed protocol-level sessions, so otherwise the
 * only thing that can carry a session across calls is the agent itself (2).
 * 2025-11-25 kept the session on the connection, so the request carries it (3).
 * 4 is for stdio, where nothing else applies.
 */
export function resolveSession(
  server: MCPServerLike,
  extra?: CompatibleRequestHandlerExtra,
  conversationId?: string,
  clientConversation?: ClientConversation
): ResolvedSession {
  const data = getServerTrackingData(server)
  if (!data) {
    throw new Error('Server tracking data not found')
  }

  // 1 and 2 belong to this one request, so they return before the shared-state
  // writes at the end: persisting them (or advancing lastActivity) would leak one
  // chat's session onto a concurrent chat's `tools/list`. On an instance that
  // never processed `initialize`, the request's token is still the only source of
  // client identity, so it is applied either way.
  if (clientConversation) {
    applyTokenClientIdentity(data, extra)
    return { sessionId: deriveSessionIdFromClientConversation(clientConversation), source: 'client_metadata' }
  }
  if (conversationId) {
    applyTokenClientIdentity(data, extra)
    return { sessionId: deriveSessionIdFromConversation(conversationId), source: 'conversation' }
  }

  // 3, else 4.
  const sessionId = readSessionIdFromRequest(data, extra) ?? getSessionIdFromMemory(data)

  // 3 and 4 are connection-scoped, so their result is remembered for the next
  // request on this instance.
  data.sessionId = sessionId
  data.lastActivity = new Date()
  setServerTrackingData(server, data)
  return { sessionId, source: instanceSessionSource(data) }
}

/** The source of the session this instance holds: steps 3 and 4 of {@link resolveSession}. */
export function instanceSessionSource(data: MCPAnalyticsData): MCPAnalyticsSessionSource {
  return data.sessionSource === 'generated' ? 'generated' : 'transport'
}

/**
 * Restores the client name/version and protocol version baked into our token at
 * mint time, and hands the decoded token back so the caller can also take the
 * session id from it. Split from step 3 because the token's two halves have
 * different scopes: its session id is per-chat (a conversation-anchored request
 * must not adopt it), its client identity is per-connection (every request on
 * the connection should).
 */
function applyTokenClientIdentity(
  data: MCPAnalyticsData,
  extra?: CompatibleRequestHandlerExtra
): SessionTokenPayload | undefined {
  const token = decodeSessionId(readMcpSessionHeader(getRequestHeaders(extra)))
  if (!token) {
    return undefined
  }
  data.sessionInfo.clientName = token.clientName
  data.sessionInfo.clientVersion = token.clientVersion
  data.sessionInfo.protocolVersion = token.protocolVersion
  return token
}

/**
 * 3. The session id a request carried. Two sources, tried in order: our own token
 * on the `mcp-session-id` header, then the raw session id a stateful transport
 * issued. Returns undefined when the request carried neither, which is what
 * sends the caller on to 4.
 *
 * Both are 2025-11-25 mechanisms; the 2026-07-28 revision removed the header
 * outright, so this step is legacy-only once era detection lands (ADR-0003).
 */
function readSessionIdFromRequest(data: MCPAnalyticsData, extra?: CompatibleRequestHandlerExtra): string | undefined {
  // 3a. A token we minted at `initialize` and the client replayed. It rides the
  // `mcp-session-id` header, which stateless transports don't surface as
  // extra.sessionId, so read the header ourselves.
  const token = applyTokenClientIdentity(data, extra)
  if (token) {
    data.sessionSource = 'token'
    return token.sessionId
  }

  // 3b. No token, but a stateful transport issued its own session id. Hash it so
  // the same MCP session maps to the same SDK session across restarts.
  if (extra?.sessionId) {
    data.sessionSource = 'mcp'
    return deriveSessionIdFromMCPSession(extra.sessionId)
  }

  return undefined
}

/**
 * 4. The request carried nothing, so keep the id this instance already holds —
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
    ipAddress: undefined,
    sdkLanguage: 'TypeScript',
    sdkVersion: version,
    serverBuild: data?.options.serverBuild,
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
