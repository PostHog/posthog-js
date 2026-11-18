---
'@posthog/mcp': minor
---

Classify client-caused failures as `$mcp_error_type: "validation"`. A tool call whose arguments failed the tool's input schema, a call to a disabled tool, a tool that rejected its arguments with JSON-RPC `-32602`, and a read of an unknown resource now carry `validation` instead of the thrown error's type, so dashboards can tell an agent's mistake from a server bug. Output-schema failures and malformed tool results, which also use `-32602`, keep the thrown type. Every failure still sends its `$exception`, as before.
