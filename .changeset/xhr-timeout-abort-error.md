---
'posthog-js': patch
---

The XHR transport now reports a timed-out request as `{ statusCode: 0, error }` with a named `AbortError`, as the fetch transport does. Feature flag requests sent over XHR now retry on timeout and record a `timeout` flag error.
