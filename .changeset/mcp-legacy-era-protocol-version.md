---
'@posthog/mcp': patch
---

Record the protocol version for 2025-11-25 traffic served by a per-request server.

That revision carries the negotiated version at the `initialize` handshake, so an MCP SDK v2 server built per HTTP request has no way to know it: the instance handling a later `tools/call` never saw the handshake, and a legacy-era request carries no `_meta` envelope for the identity chain to read. Those events went out with no `$mcp_protocol_version`.

The chain gains the one carrier that era does have — the `MCP-Protocol-Version` request header, which 2025-11-25 requires a client to send on every request after `initialize`. It is read after the protocol-level envelope and `params._meta` and before the server's own accessors, so a modern-era request still prefers the value the protocol gives it, and no era is branched on.
