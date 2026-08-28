---
'posthog-js': patch
---

Stop `sanitize_properties` from silently dropping events. A hook that returns nothing or throws now keeps the original properties and logs a warning, instead of losing the event. This protects high-volume events like `$pageview`, and matches how `before_send` already handles the same mistake.
