---
'posthog-js': patch
---

Contain a throw from a third-party patched `AbortController.abort()` when our own fetch timeout fires, so it is retried instead of escaping as an uncaught error, and report a single outcome per request.
