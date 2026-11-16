---
'@posthog/mcp': patch
---

`instrumentMutator(posthog)(server)` now returns the server's own type instead of `unknown`, so no type argument or cast is needed. Explicit `instrumentMutator<McpServer>(posthog)` calls and typed `serverMutator` hooks keep working.
