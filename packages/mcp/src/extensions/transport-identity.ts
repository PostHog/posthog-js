import type { CompatibleRequestHandlerExtra, McpEvent } from '../types'
import { readHeaderValue } from './headers'
import { getRequestHeaders } from './request-headers'

/**
 * Transport-level client identity: the two request headers that say *which
 * product* is calling, where `clientInfo` only says which client library is.
 *
 * MCP's own identity fields are too coarse to attribute usage to a surface. A
 * vendor ships many products on one client: Anthropic reports
 * `clientInfo.name = "claude-code"` from the CLI, the Agent SDK, the VS Code
 * extension, the desktop app and more, so `$mcp_client_name` collapses all of
 * them into one bucket. The distinguishing detail exists only in the User-Agent
 * parenthetical — `claude-code/2.1.0 (cli)` vs `claude-code/2.1.0 (sdk-ts)` vs
 * `claude-code/2.1.0 (claude-vscode)` — alongside vendor-specific headers like
 * `x-anthropic-client`. Capturing them is the only way a server owner can tell
 * their surfaces apart.
 *
 * We capture the raw strings and classify nothing. No vendor table, no product
 * labels: friendly names are resolved at query time server-side, so labels can
 * improve (and new surfaces can appear) without waiting on an SDK release, and
 * there is exactly one resolver rather than one per installed SDK version.
 *
 * This is deliberately separate from `client-identity.ts`. That module reads the
 * request body's `_meta` and therefore works on every transport, including stdio
 * and in-memory. Headers exist only on HTTP transports, so everything here is a
 * silent no-op elsewhere and those events stay byte-identical to before.
 */

/** Header carrying the client's product/surface, e.g. `claude-code/2.1.0 (cli)`. */
export const CLIENT_USER_AGENT_HEADER = 'user-agent'

/**
 * Vendor-specific client header. Anthropic's clients send it alongside the
 * User-Agent; it is captured verbatim as a second, independent signal rather
 * than merged into one, so a query-time resolver can prefer whichever the
 * vendor keeps stable.
 */
export const VENDOR_CLIENT_HEADER = 'x-anthropic-client'

export interface TransportIdentity {
  clientUserAgent?: string
  vendorClient?: string
}

/**
 * Reads the transport identity headers off the request. Returns `undefined`
 * when the request carries neither — including every stdio and in-memory
 * request, which has no HTTP headers at all. Never throws.
 *
 * Sourced through `getRequestHeaders` rather than `extra.requestInfo.headers`
 * directly: MCP SDK v2 puts the request at `extra.http.req` as a WHATWG
 * `Request`, so a v1-shaped read finds nothing and this whole feature would be
 * silently inert on exactly the servers being adopted now.
 */
export function readTransportIdentity(extra: CompatibleRequestHandlerExtra | undefined): TransportIdentity | undefined {
  const headers = getRequestHeaders(extra)
  if (!headers) {
    return undefined
  }
  const result: TransportIdentity = {}

  const clientUserAgent = readHeaderValue(headers, CLIENT_USER_AGENT_HEADER)
  if (clientUserAgent) {
    result.clientUserAgent = clientUserAgent
  }

  const vendorClient = readHeaderValue(headers, VENDOR_CLIENT_HEADER)
  if (vendorClient) {
    result.vendorClient = vendorClient
  }

  return result.clientUserAgent || result.vendorClient ? result : undefined
}

/**
 * Stamps the transport identity onto the event being built for *this* request,
 * so it carries `$mcp_client_user_agent` and `$mcp_vendor_client`.
 *
 * Headers are per-request, so this writes to the event — a per-request object —
 * and never to the server-wide `sessionInfo`. One instrumented server can
 * multiplex concurrent requests from different clients, and caching a header
 * into shared state would attribute one client's surface to another's event.
 * `client-identity.ts` and `capture.ts` guard the same hazard.
 *
 * Values are capped downstream by `truncateEvent`, which runs on every capture
 * path, so a hostile 1MB header cannot inflate an event.
 */
export function stampTransportIdentity(event: McpEvent, extra: CompatibleRequestHandlerExtra | undefined): void {
  const identity = readTransportIdentity(extra)
  if (!identity) {
    return
  }
  if (identity.clientUserAgent) {
    event.clientUserAgent = identity.clientUserAgent
  }
  if (identity.vendorClient) {
    event.vendorClient = identity.vendorClient
  }
}
