---
'@posthog/rrweb-utils': patch
'posthog-js': patch
---

Fix session replay and posthog-js leaving each other's `console` wrapper in the call path when either one stops
