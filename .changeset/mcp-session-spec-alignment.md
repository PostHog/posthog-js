---
'@posthog/mcp': patch
---

Session identity now follows the sdk-specs MCP analytics spec more closely:

- A session from your `sessionId` option records `$mcp_session_source` as `host` (was `transport`).
- On a one-client connection (stdio), the generated session rotates on the first tool call that arrives 30 minutes or more after the previous tool call ended. Listings and other requests no longer keep it alive or rotate it, and the most recent call, while it runs, holds it open. An earlier call that never settles does not.
- While a call's session rests on a conversation handle minted for it, its custom events wait and go out with the call's final session and identity. Past 1,000 held events, the rest are now sent at once with the session the call has without its handle, instead of being dropped.
