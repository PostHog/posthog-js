---
'@posthog/mcp': patch
---

Classify client-caused validation failures as `$mcp_error_type: "validation"`. A tool call whose arguments failed the tool's input schema, a tool that rejected its arguments with JSON-RPC `-32602`, and a read of an unknown resource (`-32002`) keep `$mcp_is_error: true` but no longer send an `$exception`, so they stop showing up as server bugs in error tracking. Output-schema failures, which also use `-32602`, are still the server's and keep their `$exception`.
