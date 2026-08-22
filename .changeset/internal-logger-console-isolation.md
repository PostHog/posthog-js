---
'posthog-js': patch
'@posthog/browser-common': patch
---

fix(browser): keep PostHog logger output out of console capture

PostHog logger output now bypasses PostHog console instrumentation. Client rate-limit diagnostics remain visible without appearing as customer exceptions or logs.
