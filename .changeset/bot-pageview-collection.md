---
'posthog-js': minor
'posthog-node': minor
---

Add bot pageview collection behind preview flag. Enables tracking bot traffic as `$bot_pageview` events when the `__preview_send_bot_pageviews` flag is enabled, keeping bot interactions separate from real user pageviews while maintaining backward compatibility.
