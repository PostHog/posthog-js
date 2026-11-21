---
'@posthog/mcp': minor
---

Add `captureRejectedRequest(posthog, data)` and `PostHogMCP.captureRejectedRequest(data)` to record requests an HTTP layer rejects before the MCP server runs (401, 403, 429, 400). They emit `$mcp_request_rejected` with `$mcp_is_error: true`, `$mcp_error_status` and a `$mcp_error_type` derived from the status (`auth`, `rate_limited` or `protocol`)
