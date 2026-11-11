---
'@posthog/mcp': minor
---

A failed tool call now sets `$mcp_error_status` to the HTTP status behind it, read from the thrown error or its `cause` chain (`status_code`, `statusCode` or `status`, on the error or its `response`, as a fetch `Response`, axios and got carry it). Failures from an upstream API now group by status in MCP Analytics instead of landing in "unknown".
