---
'@posthog/mcp': patch
---

Ignore non-string `name`/`version` values returned by the `clientInfo` option instead of recording them as the MCP client.
