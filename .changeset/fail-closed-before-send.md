---
'@posthog/core': patch
'posthog-js': patch
'@posthog/convex': patch
---

Drop events when a before-send hook throws instead of sending the unmodified event.
