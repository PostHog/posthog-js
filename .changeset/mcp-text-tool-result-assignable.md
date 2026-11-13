---
'@posthog/mcp': patch
---

`getMoreToolsResult()` and `sendFeedbackResult()` are now typed so they can be returned from an MCP SDK tool handler (v1 and v2 `CallToolResult`) without a cast.
