---
'posthog-js': patch
---

Catch synchronous throws from a monkey-patched `window.fetch` so they no longer escape as unhandled exceptions. A synchronous throw is now routed through the same handling as an async rejection, so the request queue retries instead of the error leaking into error tracking.
