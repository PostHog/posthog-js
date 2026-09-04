---
'posthog-js': patch
---

Prevent session replay network capture from replacing a downstream fetch wrapper's response with an instrumentation error when the response has no headers.
