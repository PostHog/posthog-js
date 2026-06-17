---
'@posthog/mcp': minor
---

Bring the `PostHogMCP` custom-dispatcher path to feature parity with `instrument()`. Custom MCP servers (hono, edge, any setup without a `Server`/`McpServer` to wrap) can now capture intent, the `get_more_tools` virtual tool, and tool listings:

- `prepareToolList(tools, { context, reportMissing })` injects the `context` argument into tool input schemas and optionally appends the `get_more_tools` tool.
- `prepareToolCall(name, args)` returns `{ intent, intentSource, args, isMissingCapability }` — pulls the agent-supplied intent, strips the injected `context` argument before your handler runs, and flags `get_more_tools` calls.
- `captureToolCall` now accepts `intent`/`intentSource`, emitting `$mcp_intent` and `$mcp_intent_source`.
- `captureMissingCapability(...)` emits `$mcp_missing_capability`, plus a standalone `getMoreToolsResult()` for the canned response.
- `captureToolsList(...)` emits `$mcp_tools_list` with the advertised tool names.
- `setLogger` is now exported so custom servers can surface the SDK's internal warnings.
- The `get_more_tools` tool name is now customizable via the `getMoreToolsName` constructor option (defaults to `get_more_tools`). Setting it once keeps `prepareToolList` injection and `prepareToolCall` detection in sync.
