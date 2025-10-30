---
'posthog-js': minor
'@posthog/core': minor
'posthog-node': minor
---

Add bot pageview collection behind preview flag. Enables tracking bot traffic as `$bot_pageview` events when the `__preview_capture_bot_pageviews` flag is enabled.
