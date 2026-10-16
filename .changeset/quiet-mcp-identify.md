---
'@posthog/mcp': minor
---

Stop sending standalone `$identify` events. The `identify` callback still sets `distinct_id` and `$set` on every event.
