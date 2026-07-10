---
'@posthog/mcp': minor
---

feat(mcp): stable sessions and client metadata on stateless / multi-pod MCP servers

On stateless servers every request became its own session and `$mcp_client_name`/`$mcp_client_version` were missing after `initialize`. The SDK now mints the `Mcp-Session-Id` response header at `initialize` as a token carrying the session id and client name/version; clients replay it on every request, so any pod recovers both with no server-side store. Auto-minting requires `enableJsonResponse: true` on `StreamableHTTPServerTransport`; SSE-mode servers can set the header at the HTTP layer with the new exports.

New exports: `encodeSessionId`, `decodeSessionId`, `MCP_SESSION_HEADER`, `SessionTokenPayload`, `newSessionId`.
