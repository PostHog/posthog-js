---
'@posthog/mcp': patch
---

Stop copying the full tool list into `$mcp_response` on `$mcp_tools_list` events, so instrumented servers answer `tools/list` faster.
