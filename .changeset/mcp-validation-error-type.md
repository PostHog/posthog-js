---
'@posthog/mcp': minor
---

Classify client-caused failures as `$mcp_error_type: "validation"`. A tool call whose arguments failed the tool's input schema, a call to a disabled tool, a tool that rejected its arguments with JSON-RPC `-32602`, and a read of an unknown resource keep `$mcp_is_error: true` but no longer send an `$exception`, so they stop showing up as server bugs in error tracking. Output-schema failures and malformed tool results, which also use `-32602`, are the server's and keep their `$exception`. An `errorType: "validation"` you pass to `captureToolCall` yourself still sends its `$exception` as before.
