---
'@posthog/mcp': minor
---

Add `analytics.flush()`, which waits until every event the server has captured so far, auto-captured ones included, is handed to `posthog-node`, then flushes the `posthog-node` queue. Await it before a per-request runtime (serverless or edge functions) freezes or exits, instead of waiting a macrotask before `posthog.shutdown()`
