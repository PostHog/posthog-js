---
'posthog-js': patch
'@posthog/core': patch
'posthog-node': patch
---

Add bot pageview collection behind preview flag. Enables tracking bot traffic as $bot_pageview events when the \_\_preview_capture_bot_pageviews flag is enabled.
