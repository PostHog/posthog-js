---
'@posthog/mcp': minor
---

Add `createMcpAnalytics(posthog, options?)`, a server-agnostic capture API for MCP servers that don't expose a `Server`/`McpServer` to wrap (e.g. custom hono/HTTP dispatchers). It returns a handle with `captureToolCall`, `captureInitialize`, and `capture`, running each event through the same sanitize → truncate → `$exception` fan-out → `beforeSend` pipeline as `instrument()` and emitting the same canonical `$mcp_*` events. The caller passes `distinctId`/`sessionId`/`groups`/`properties` per call. `$session_id` is now omitted from events when no session is supplied (previously always set), so stateless captures don't bucket into a non-existent Session Replay session.
