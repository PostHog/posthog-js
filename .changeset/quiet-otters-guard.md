---
'posthog-js': patch
---

Contain a throw from a third-party `abort` listener when our own fetch timeout fires, so it is retried instead of escaping as an uncaught error.
