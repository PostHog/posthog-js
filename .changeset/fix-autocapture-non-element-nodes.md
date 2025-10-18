---
'posthog-js': patch
---

Fix autocapture crash when encountering non-Element DOM nodes (text nodes, comment nodes, etc.) that don't have a tagName property