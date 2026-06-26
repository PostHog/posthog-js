---
'@posthog/mcp': patch
---

Instrument MCP request handlers through a single `setRequestHandler` patch instead of one per method. Internal refactor — no change to the analytics captured.
