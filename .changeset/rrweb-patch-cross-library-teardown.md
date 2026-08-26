---
'@posthog/rrweb-plugin-console-record': patch
'@posthog/rrweb-utils': patch
'@posthog/rrweb': patch
'@posthog/rrweb-record': patch
'posthog-js': patch
---

Fix session replay leaving its `console` wrapper in the call path when it stops while posthog-js is also wrapping `console`
