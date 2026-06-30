---
'@posthog/mcp': minor
---

Stamp `$mcp_error_type` and `$mcp_error_message` on `$mcp_tool_call` (and `$mcp_tools_list`) when a call fails. Previously the only failure signal on the primary event was the `$mcp_is_error` boolean, so breaking failures down by reason meant joining to the `$exception` sibling (which can be disabled, and isn't emitted when no error value is passed). `$mcp_error_type` defaults to the thrown error's type, and `captureToolCall`/`captureToolsList` accept an explicit low-cardinality `errorType` label (e.g. `validation`, `permission`, `timeout`, `rate_limited`) for hosts that classify their own failures.
