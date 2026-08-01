---
'posthog-js': patch
---

Attach a synthetic exception stack in `wrapOnError` and `wrapUnhandledRejection` so autocaptured exceptions that fail the `isError()` check (cross-realm, structured-cloned, or JSON round-tripped errors) still ship with a usable stacktrace.
