---
'@posthog/mcp': patch
---

fix(mcp): keep the thrown value on high-level `McpServer` tool calls, so `$mcp_error_type` and `$mcp_error_status` reflect what the tool threw. This covers MCP SDK v2, a thrown value that is not an `Error`, and servers built per request that share tool functions. For a thrown non-`Error`, `$mcp_error_message` and error grouping now describe the thrown value (for example `'UpstreamError' captured as exception with message: 'bad'`) instead of `[object Object]`. The error type is now redacted like the message, and a thrown value whose getters throw is still recorded.
