---
'@posthog/core': patch
---

Add `clearQueue` to `PostHogLogs`, so dropping queued records cannot make an in-flight batch discard records captured afterwards
