---
'@posthog/mcp': patch
---

`PostHogMCP.flush()` and `shutdown()` now wait for MCP captures still in the pipeline, so an event captured just before them is sent.
