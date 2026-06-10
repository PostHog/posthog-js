---
'@posthog/mcp': minor
---

Add `PostHogMCP`, a `posthog-node` client subclass with first-class MCP analytics for servers that have no `Server`/`McpServer` to wrap (e.g. custom hono/HTTP dispatchers). It extends `PostHog` — so `capture`, `identify`, `flush`, `shutdown`, and feature flags all work unchanged — and adds `captureToolCall` / `captureInitialize`, which build the canonical `$mcp_*` events and run them through the same sanitize → truncate → `$exception` fan-out pipeline as `instrument()` before handing them to the inherited `capture()` (so the client's own `beforeSend` applies). The caller passes `distinctId`/`sessionId`/`groups`/`properties` per call. `$session_id` is now omitted from events when no session is supplied (previously always set), so stateless captures don't bucket into a non-existent Session Replay session.
