---
'@posthog/mcp': minor
---

Record an `input_required` round as `$mcp_input_required` instead of a `$mcp_tool_call`, and add `PostHogMCP.captureInputRequired()` with `inputRequestMethods` on `prepareToolResult()` for custom dispatchers.
