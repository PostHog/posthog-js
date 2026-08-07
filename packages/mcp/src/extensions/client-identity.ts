import type { CompatibleRequestHandlerExtra, McpEvent, MCPRequestLike, MCPServerLike } from '../types'
import { hasClientVersionAccessor, hasNegotiatedProtocolVersionAccessor } from './detect'

/**
 * Client identity — who is calling, and which spec revision they speak.
 *
 * Where it lives depends on the revision the *request* declares, so this is a
 * fallback chain and never a branch: one server serves both eras, request by
 * request.
 *
 *   1. `ctx.mcpReq.envelope` — MCP SDK v2 lifts the reserved
 *      `io.modelcontextprotocol/*` keys out of `_meta` before dispatch, so by
 *      the time a handler runs they are here and `params._meta` is empty.
 *   2. `request.params._meta` — where 2026-07-28 puts them on the wire, and
 *      where they still are on any server that does not lift them.
 *   3. the server's own accessors — `getClientVersion()` from a legacy
 *      `initialize` handshake, `getNegotiatedProtocolVersion()` on v2.
 *
 * The 2026-07-28 revision removed the `initialize` handshake and the
 * `Mcp-Session-Id` header (SEP-2575 / SEP-2567), so client name/version and the
 * protocol version no longer arrive once per connection — they travel with
 * every request. The key strings are mirrored here rather than imported,
 * because no `@modelcontextprotocol/*` package is a dependency of this one.
 */
export const META_CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo'
export const META_PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion'

export interface MetaClientInfo {
  clientName?: string
  clientVersion?: string
  protocolVersion?: string
}

/** Everything a request can be asked about who is calling. */
export interface ClientIdentitySources {
  request: MCPRequestLike
  extra?: CompatibleRequestHandlerExtra
  server?: MCPServerLike
}

type UnknownRecord = Record<string, unknown>

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Pulls `{ name, version }` out of a reserved-key value, whatever carried it. */
function readClientInfoValue(value: unknown): MetaClientInfo | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const { name, version } = value as UnknownRecord
  const result: MetaClientInfo = {}
  const clientName = nonEmptyString(name)
  const clientVersion = nonEmptyString(version)
  if (clientName) {
    result.clientName = clientName
  }
  if (clientVersion) {
    result.clientVersion = clientVersion
  }
  return result.clientName || result.clientVersion ? result : undefined
}

function readReservedKeys(bag: unknown): MetaClientInfo | undefined {
  if (!bag || typeof bag !== 'object') {
    return undefined
  }
  const record = bag as UnknownRecord
  const result: MetaClientInfo = { ...readClientInfoValue(record[META_CLIENT_INFO_KEY]) }
  const protocolVersion = nonEmptyString(record[META_PROTOCOL_VERSION_KEY])
  if (protocolVersion) {
    result.protocolVersion = protocolVersion
  }
  return result.clientName || result.clientVersion || result.protocolVersion ? result : undefined
}

/**
 * Reads the client name/version and protocol version a modern client puts in
 * `params._meta`. Returns `undefined` when the request carries none (e.g. a
 * legacy client, which sends this on `initialize` instead). Never throws.
 */
export function readMetaClientInfo(request: MCPRequestLike): MetaClientInfo | undefined {
  return readReservedKeys(request.params?._meta)
}

/**
 * Reads the same keys from MCP SDK v2's request envelope. v2 strips the reserved
 * `io.modelcontextprotocol/*` keys from `_meta` while parsing, so on exactly the
 * traffic this matters for, `readMetaClientInfo` finds nothing and this finds
 * everything.
 */
export function readEnvelopeClientInfo(extra: CompatibleRequestHandlerExtra | undefined): MetaClientInfo | undefined {
  return readReservedKeys((extra as { mcpReq?: { envelope?: unknown } } | undefined)?.mcpReq?.envelope)
}

/**
 * Asks the server itself. `getClientVersion()` answers on any server that
 * handled an `initialize` (and v2 hosts such as `createMcpHandler` backfill it
 * from the envelope); `getNegotiatedProtocolVersion()` exists on v2 only, which
 * is why it is a link in the chain rather than a branch. Never throws — a
 * server that dislikes being asked must not fail the tool call.
 */
export function readServerClientIdentity(server: MCPServerLike | undefined): MetaClientInfo | undefined {
  if (!server) {
    return undefined
  }
  const result: MetaClientInfo = {}
  try {
    if (hasClientVersionAccessor(server)) {
      Object.assign(result, readClientInfoValue(server.getClientVersion()))
    }
    if (hasNegotiatedProtocolVersionAccessor(server)) {
      const negotiated = (
        server as unknown as { getNegotiatedProtocolVersion(): unknown }
      ).getNegotiatedProtocolVersion()
      const protocolVersion = nonEmptyString(negotiated)
      if (protocolVersion) {
        result.protocolVersion = protocolVersion
      }
    }
  } catch {
    // fall through to whatever was read before the accessor objected
  }
  return result.clientName || result.clientVersion || result.protocolVersion ? result : undefined
}

/**
 * Resolves client identity through the whole chain, field by field: the first
 * source that answers a field wins, and a source that answers nothing simply
 * does not participate. Field-by-field rather than source-by-source because a
 * request may carry its protocol version in the envelope while the client's
 * name is only known to the server from a handshake.
 */
export function resolveClientIdentity({ request, extra, server }: ClientIdentitySources): MetaClientInfo | undefined {
  const chain = [readEnvelopeClientInfo(extra), readMetaClientInfo(request), readServerClientIdentity(server)]
  const result: MetaClientInfo = {}
  for (const source of chain) {
    if (!source) {
      continue
    }
    result.clientName ??= source.clientName
    result.clientVersion ??= source.clientVersion
    result.protocolVersion ??= source.protocolVersion
  }
  return result.clientName || result.clientVersion || result.protocolVersion ? result : undefined
}

/**
 * Stamps whatever the chain resolved onto the event being built for *this*
 * request, so it carries `$mcp_client_name`, `$mcp_client_version` and
 * `$mcp_protocol_version` even when there was no `initialize` to learn them
 * from (the modern stateless case).
 *
 * Writing to the event — a per-request object — rather than the server-wide
 * `sessionInfo` keeps identity correct when one instrumented server multiplexes
 * concurrent requests from different clients (which the stateless spec allows):
 * a sibling request can't clobber this event's attribution between now and when
 * it's captured. Only fields actually resolved are set, so a request that
 * carries nothing leaves the event's existing values untouched.
 */
export function stampClientIdentity(
  event: McpEvent,
  request: MCPRequestLike,
  extra?: CompatibleRequestHandlerExtra,
  server?: MCPServerLike
): void {
  const info = resolveClientIdentity({ request, extra, server })
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
