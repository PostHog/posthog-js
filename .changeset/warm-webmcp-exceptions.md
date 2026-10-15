---
'posthog-js': patch
---

Capture WebMCP failures in Error Tracking when exception autocapture is enabled. With `posthog-js/slim`, add `ErrorTrackingExtensions` next to `WebMCPExtensions` to get these events.
