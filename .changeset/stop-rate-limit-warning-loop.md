---
'posthog-js': patch
'@posthog/browser-common': patch
---

fix(browser): keep PostHog logger output out of error tracking

PostHog logger output is now excluded from console error autocapture. Client rate-limit drops also use a debug-gated warning, which prevents recursive captures and keeps SDK diagnostics out of customer exceptions.
