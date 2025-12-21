---
'posthog-js': patch
---

fix: the way we added lazy loaded files could cause hydration errors (in a race against hydration). let's avoid that
