---
'posthog-js': minor
---

Reject the strings "undefined" and "null" in posthog.identify(). All invalid distinct IDs now log a critical console error (always visible, not debug-only).
