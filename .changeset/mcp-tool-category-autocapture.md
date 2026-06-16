---
'@posthog/mcp': minor
---

Auto-capture `$mcp_tool_category` on `$mcp_tool_call` events. The wrapping path (`track()`/`instrument()`) reads a `category` declared on a tool's `_meta` block (cached from `tools/list` and seeded from `_registeredTools`), and `PostHogMCP.captureToolCall` accepts a first-class `category` field. Declaring `_meta: { category: "Logs" }` on a tool definition is all a server needs for every call to carry the category, enabling per-category dashboards in PostHog MCP analytics.
