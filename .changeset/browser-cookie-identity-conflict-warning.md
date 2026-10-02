---
'posthog-js': patch
---

Warn in debug mode when `'localStorage+cookie'` persistence discards a `distinct_id` that the persistence cookie carries and localStorage disagrees with, so a server-set visitor ID that the SDK drops is visible instead of silent.
