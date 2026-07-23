import type { MCPAnalyticsData, MCPRequestLike } from '../types'

/**
 * Client identity under the MCP 2026-07-28 (stateless) revision.
 *
 * That revision removes the `initialize` handshake and the `Mcp-Session-Id`
 * header (SEP-2575 / SEP-2567). Client name/version and the protocol version no
 * longer arrive once at `initialize` — they travel in every request's
 * `params._meta` under these reverse-DNS keys. We mirror the literal key strings
 * here rather than depend on the (still beta) v2 SDK, which is not a dependency
 * of this package.
 */
export const META_CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo'
export const META_PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion'

export interface MetaClientInfo {
  clientName?: string
  clientVersion?: string
  protocolVersion?: string
}

/**
 * Reads the client name/version and protocol version a modern client puts in
 * `params._meta`. Returns `undefined` when the request carries none (e.g. a
 * legacy client, which sends this on `initialize` instead). Never throws.
 */
export function readMetaClientInfo(request: MCPRequestLike): MetaClientInfo | undefined {
  const meta = request.params?._meta
  if (!meta || typeof meta !== 'object') {
    return undefined
  }
  const record = meta as Record<string, unknown>
  const result: MetaClientInfo = {}

  const clientInfo = record[META_CLIENT_INFO_KEY]
  if (clientInfo && typeof clientInfo === 'object') {
    const { name, version } = clientInfo as Record<string, unknown>
    if (typeof name === 'string' && name.length > 0) {
      result.clientName = name
    }
    if (typeof version === 'string' && version.length > 0) {
      result.clientVersion = version
    }
  }

  const protocolVersion = record[META_PROTOCOL_VERSION_KEY]
  if (typeof protocolVersion === 'string' && protocolVersion.length > 0) {
    result.protocolVersion = protocolVersion
  }

  return result.clientName || result.clientVersion || result.protocolVersion ? result : undefined
}

/**
 * Copies any client identity found in `params._meta` onto the shared session
 * info, so events built later in the request carry `$mcp_client_name`,
 * `$mcp_client_version`, and `$mcp_protocol_version` even when there was no
 * `initialize` to learn them from (the modern stateless case). Only fields the
 * request actually carries are written — a request without `_meta` leaves the
 * existing values (from a session token / initialize) untouched.
 */
export function applyMetaClientInfo(data: MCPAnalyticsData, request: MCPRequestLike): void {
  const info = readMetaClientInfo(request)
  if (!info) {
    return
  }
  if (info.clientName) {
    data.sessionInfo.clientName = info.clientName
  }
  if (info.clientVersion) {
    data.sessionInfo.clientVersion = info.clientVersion
  }
  if (info.protocolVersion) {
    data.sessionInfo.protocolVersion = info.protocolVersion
  }
}
