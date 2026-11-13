---
'@posthog/core': minor
'@posthog/ai': patch
'@posthog/mcp': patch
'posthog-node': patch
---

Export the table of per-event options and the event properties posthog-node 5 reads instead, so posthog-node, `@posthog/ai` and `@posthog/mcp` share one copy.
