---
'@posthog/mcp': patch
---

Resolve client name, version and protocol version through a fallback chain, so events from an MCP SDK v2 server carry them.

MCP SDK v2 lifts the reserved `io.modelcontextprotocol/*` keys — `clientInfo`, `protocolVersion`, `clientCapabilities` — out of `params._meta` while parsing a request, and puts them on the request envelope. We only read `params._meta`, which is empty by the time a handler runs, so `$mcp_client_name`, `$mcp_client_version` and `$mcp_protocol_version` went missing on exactly the modern-era traffic that carries them per request rather than at `initialize`.

Identity is now resolved field by field through three sources in order: the v2 request envelope, then `params._meta`, then the server's own `getClientVersion()` and (v2-only) `getNegotiatedProtocolVersion()`. A chain rather than a branch, because the same v2 server serves 2025-era requests routinely — era is a per-request property, never a module constant — and because a field one source cannot answer may still be known to the next.
