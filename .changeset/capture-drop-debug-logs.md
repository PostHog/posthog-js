---
'posthog-js': patch
---

Log the reason in debug mode when `capture()` drops an event because capturing is disabled or the user agent looks like a bot, and clarify the `has_opted_out_capturing()` docs for cookieless 'always' mode.
