---
'posthog-js': patch
---

Fail open when an error tracking suppression rule cannot be evaluated, so an unknown operator or a key outside `$exception_types` / `$exception_values` no longer drops the exception.
