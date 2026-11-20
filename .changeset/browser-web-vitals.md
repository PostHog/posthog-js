---
'@posthog/browser': minor
'@posthog/browser-common': minor
'posthog-js': patch
---

Add web vitals capture to `@posthog/browser`. In posthog-js, web vitals no longer start after fresh remote config turns them off, and `shutdown()` stops web vitals capture.
