---
'posthog-js': patch
---

fix: session id rotation relied on in-memory cache which would be stale after log idle periods - particularly with multiple windows in play
