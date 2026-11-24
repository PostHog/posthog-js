---
'posthog-js': patch
---

Stop web vitals from starting after fresh remote config disables them, and stop capture and discard buffered metrics on `shutdown()`.
