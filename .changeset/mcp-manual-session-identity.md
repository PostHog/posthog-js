---
'@posthog/mcp': minor
---

`PostHogMCP`'s step path (`prepareToolCall`, `prepareToolResult`, `captureToolCall`) now resolves sessions the way `instrument()` does, per the sdk-specs MCP analytics spec:

- `prepareToolCall`'s `sessionId` is a transport session: a PostHog session token gives the session inside it, and any other id is hashed into a `ses_` id. Before, it was sent as given, so the same `Mcp-Session-Id` produced different `$session_id` values on the two paths.
- New `connectionKey` option for one-client connections (stdio): the SDK keeps a session per key and rotates it after 30 idle minutes.
- A minted conversation handle that never reaches the agent no longer sets the session.
- `prepareToolCall` and `prepareToolResult` return `sessionSource`, and capture methods accept it as `$mcp_session_source`. A capture without a `sessionId` records `generated`.
