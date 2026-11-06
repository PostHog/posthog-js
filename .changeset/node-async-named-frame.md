---
'@posthog/core': patch
'@posthog/mcp': patch
'posthog-node': patch
---

Parse Node stack frames for functions named `async` without a leading parenthesis in the filename.
