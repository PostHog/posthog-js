---
'@posthog/core': minor
---

Add `PostHogLogs` APIs for hosts that buffer log records themselves: an optional `capturedAt` argument to `captureLog` for stamping a record with a caller-supplied event time and context, and `clearQueue` for dropping queued records without an in-flight batch discarding what was captured afterwards
