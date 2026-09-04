---
'@posthog/core': patch
'posthog-js': patch
---

Stop counting stack frames that have no filename (in-app browser bridge scripts and other code the runtime reports without a script URL) as in-app code.
