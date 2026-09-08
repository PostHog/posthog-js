---
'posthog-js': patch
---

Restore retry queue connectivity tracking when a page returns from the back-forward cache, without reactivating it after an explicit `shutdown()`.
