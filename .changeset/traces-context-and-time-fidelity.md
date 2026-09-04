---
'@posthog/core': patch
---

Forward an inbound `traceparent` whose version is above `00` whole, including the fields that version adds, rather than trimming it to the four this SDK reads. Keep the inbound context when a handle returned with tracing off is passed back as `parent`, so a child no longer starts a fresh trace. Warn when a span's `startTime` is in the future, which costs it its duration.
