---
'@posthog/mcp': patch
---

Forward $groups as a first-class groups field from the MCP analytics sink so the group association is no longer dropped on $mcp\_\* events (fixes #3888).
