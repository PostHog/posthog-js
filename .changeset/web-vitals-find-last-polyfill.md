---
'@posthog/browser-common': patch
'posthog-js': patch
---

Polyfill `Array.prototype.findLast` in the web vitals attribution bundles so they keep capturing on browsers older than Chrome 97 and Safari 15.4
