---
'posthog-js': patch
'@posthog/types': patch
---

We were missing some public definitions inside `@posthog/types` so let's fix them here. We've also fixed the typing inside the `loaded` callback
