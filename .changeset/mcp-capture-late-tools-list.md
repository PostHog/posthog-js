---
'@posthog/mcp': patch
---

Capture tool listings (and the injected `context` parameter) on MCP servers that register their `tools/list` handler after `instrument()` runs — e.g. `@rekog/mcp-nest`, which hands a bare server to `instrument()` and only then registers its handlers.
