---
'@posthog/mcp': patch
---

Session identity now follows the sdk-specs MCP analytics spec more closely:

- A session from your `sessionId` option records `$mcp_session_source` as `host` (was `transport`).
- On a one-client connection (stdio), the generated session rotates on the first tool call that arrives 30 minutes or more after the previous tool call ended. Listings and other requests no longer keep it alive or rotate it, and a call still running holds it open.
- Past 1,000 custom events held during one call, the rest are sent at once with the session the call has without its minted handle, instead of being dropped. (A call holds its custom events while its session rests on a conversation handle minted for it, then sends them with the call's final session and identity.)
