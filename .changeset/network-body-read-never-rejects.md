---
'posthog-js': patch
---

Stop a failed replay network body read from escaping into the host page's own `fetch()` call. On Safari, canceling a reader whose transfer already died rejects with `TypeError: Load failed`; the streaming body reader now swallows that rejection and the fetch patch guards the response body read.
