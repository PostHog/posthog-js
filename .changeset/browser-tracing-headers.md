---
'@posthog/browser': minor
'@posthog/browser-common': minor
'posthog-js': patch
---

Add tracing headers to `@posthog/browser`. In posthog-js, a distinct ID that cannot be sent as a header no longer breaks XHR or `fetch(Request)`: those requests go out without PostHog tracing headers.
