---
"@posthog/mcp": patch
---

Read the MCP client name/version and protocol version from each request's `_meta` (`io.modelcontextprotocol/clientInfo` and `io.modelcontextprotocol/protocolVersion`), so `$mcp_client_name`, `$mcp_client_version`, and `$mcp_protocol_version` keep populating under the MCP 2026-07-28 stateless revision, which removes the `initialize` handshake. Existing clients are unaffected — when `_meta` is absent, the values from the session token / `initialize` still apply.
