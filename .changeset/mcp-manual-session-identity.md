---
'@posthog/mcp': minor
---

`PostHogMCP`'s step path (`prepareToolCall`, `prepareToolResult`, `captureToolCall`) now resolves sessions the way `instrument()` does, per the sdk-specs MCP analytics spec:

- `prepareToolCall`'s `sessionId` is a transport session: a PostHog session token gives the session inside it, and any other id is hashed into a `ses_` id. Before, it was sent as given, so the same `Mcp-Session-Id` produced different `$session_id` values on the two paths.
- New `connectionKey` option for one-client connections (stdio): the SDK keeps a session per key and rotates it on the first call 30 minutes or more after the previous one ended. Call `prepareToolResult` for failed calls too, since a call holds the session open until then.
- New `resolveSession({ sessionId, connectionKey })` gives `captureInitialize`, `captureToolsList` and other out-of-call captures the tool calls' session. Those methods still send a `sessionId` as given, so if you passed the raw transport id to them, spread `resolveSession` in instead to keep one session per connection.
- A minted conversation handle that never reaches the agent no longer sets the session.
- `prepareToolCall` and `prepareToolResult` return `sessionSource`, and capture methods accept it as `$mcp_session_source`. A capture without a `sessionId` records `generated`.
