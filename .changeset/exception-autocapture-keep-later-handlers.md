---
'posthog-js': patch
---

Stopping exception autocapture no longer removes `window.onerror`, `window.onunhandledrejection`, or `console.error` handlers installed on top of PostHog's.
