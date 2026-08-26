---
'@posthog/rrweb-plugin-console-record': patch
'@posthog/rrweb-utils': patch
'@posthog/rrweb': patch
'@posthog/rrweb-record': patch
'posthog-js': patch
---

Fix session replay and posthog-js leaving each other's `console` wrapper in the call path when either one stops
