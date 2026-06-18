---
'@posthog/mcp': minor
---

Bring the `PostHogMCP` custom-dispatcher path up to the same `$mcp_*` events as `instrument()` for intent, the `get_more_tools` virtual tool, and tool listings. Custom MCP servers (hono, edge, any setup without a `Server`/`McpServer` to wrap) can now emit those events too. (`instrument()`'s server-side `intentFallback` and `enableConversationId` callbacks aren't mirrored — a custom dispatcher owns its request loop and can do both inline.)

- `prepareToolList(tools, { context, reportMissing })` injects the `context` argument into tool input schemas and optionally appends the `get_more_tools` tool.
- `prepareToolCall(name, args)` returns `{ intent, intentSource, args, isMissingCapability }` — pulls the agent-supplied intent, strips the injected `context` argument before your handler runs, and flags `get_more_tools` calls.
- `captureToolCall` now accepts `intent`/`intentSource`, emitting `$mcp_intent` and `$mcp_intent_source`.
- `captureMissingCapability(...)` emits `$mcp_missing_capability`, plus a standalone `getMoreToolsResult()` for the canned response.
- `captureToolsList(...)` emits `$mcp_tools_list` with the advertised tool names.
- `setLogger` is now exported so custom servers can surface the SDK's internal warnings.
- The missing-capability (`get_more_tools`) tool name is now customizable via `missingCapabilityToolName` (defaults to `get_more_tools`) on **both** paths: the `PostHogMCP` constructor option and the `instrument()` `MCPAnalyticsOptions`. Set once, it's used for both advertising the tool and detecting calls to it, so the name can't drift between injection and detection.
