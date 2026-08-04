---
'@posthog/mcp': patch
---

Preserve real missing-capability tools when their names collide with the configured virtual tool.
Restore `$mcp_tool_call` analytics for low-level servers that register their tool dispatcher after instrumentation.
