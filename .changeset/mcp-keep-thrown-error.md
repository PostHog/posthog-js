---
'@posthog/mcp': patch
---

fix(mcp): keep the thrown value on high-level `McpServer` tool calls, so `$mcp_error_type` and `$mcp_error_status` reflect what the tool threw. This covers MCP SDK v2, a thrown value that is not an `Error`, and servers built per request that share tool functions.
