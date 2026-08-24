---
'posthog-js': patch
'@posthog/types': patch
---

Drop exceptions thrown by user scripts the browser injects into every page (Firefox for iOS, Chrome for iOS) instead of reporting them as the page's own errors. Set `error_tracking.captureExtensionExceptions: true` to keep capturing them.
