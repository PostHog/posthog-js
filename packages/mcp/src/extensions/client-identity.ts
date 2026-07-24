import type { McpEvent, MCPRequestLike } from '../types'

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
 * Stamps any client identity found in `params._meta` directly onto the event
 * being built for *this* request, so it carries `$mcp_client_name`,
 * `$mcp_client_version`, and `$mcp_protocol_version` even when there was no
 * `initialize` to learn them from (the modern stateless case).
 *
 * Writing to the event — a per-request object — rather than the server-wide
 * `sessionInfo` keeps identity correct when one instrumented server multiplexes
 * concurrent requests from different clients (which the stateless spec allows):
 * a sibling request can't clobber this event's attribution between now and when
 * it's captured. Only fields the request actually carries are set, so a request
 * without `_meta` leaves the event's existing values untouched.
 */
export function stampMetaClientInfo(event: McpEvent, request: MCPRequestLike): void {
  const info = readMetaClientInfo(request)
  if (!info) {
    return
  }
  if (info.clientName) {
    event.clientName = info.clientName
  }
  if (info.clientVersion) {
    event.clientVersion = info.clientVersion
  }
  if (info.protocolVersion) {
    event.protocolVersion = info.protocolVersion
  }
}
