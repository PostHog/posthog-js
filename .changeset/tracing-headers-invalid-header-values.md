---
'posthog-js': patch
---

Tracing headers no longer break an app's request when the distinct ID cannot be sent as a header value: the request goes out without the distinct ID header, and a `fetch(Request)` keeps its body.
