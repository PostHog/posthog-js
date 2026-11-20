---
'posthog-js': patch
---

Stopping exception autocapture no longer removes `window.onerror`, `window.onunhandledrejection` or `console.error` handlers that other code installed on top of PostHog's. PostHog's handler stays in their chain and only forwards to the original handler
