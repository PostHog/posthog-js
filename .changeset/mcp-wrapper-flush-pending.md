---
'@posthog/mcp': patch
---

`PostHogMCP.flush()` and `shutdown()` now wait for MCP captures still in the pipeline before flushing, within the shutdown deadline, instead of relying on the pipeline finishing first.
