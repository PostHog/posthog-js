---
'posthog-js': patch
---

Prevent failed replay network body reads from escaping into the host page's own `fetch()` call
