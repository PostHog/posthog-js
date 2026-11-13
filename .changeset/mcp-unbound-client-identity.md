---
'@posthog/mcp': patch
---

An HTTP request that carries no session no longer takes `$mcp_client_name`, `$mcp_client_version` or `$mcp_protocol_version` from an `initialize` handshake or another request's session token on the same instance. On a shared HTTP instance, those name whichever client came before, so such a request is now unidentified unless it identifies itself, as the sdk-specs MCP analytics spec requires.
