---
'@posthog/browser-common': patch
'posthog-js': patch
---

Keep the rest of the URL when masking personal data query params and a query value contains `?` or the hash contains `#`.
