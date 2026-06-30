---
'@posthog/mcp': minor
---

Stamp the standard PostHog `$lib` / `$lib_version` (value `posthog-node-mcp`) on every event, so MCP events self-identify the same way every other PostHog SDK does. Both emit paths are covered: `PostHogMCP` overrides its library id, and `instrument()` applies it to the client you pass in. Note that posthog-node sets `$lib` at the client level, so for `instrument()` this relabels every event that client sends as `posthog-node-mcp` — pass a client dedicated to your MCP server's analytics.
