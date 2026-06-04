---
'posthog-js': patch
---

When using tracing headers, `X-POSTHOG-DISTINCT-ID` is read at request time instead of when fetch/XHR is patched, ensuring it reflects bootstrap, identify, reset, and other identity changes.
