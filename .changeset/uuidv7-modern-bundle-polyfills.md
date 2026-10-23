---
'posthog-js': patch
'@posthog/browser-common': patch
---

Ship the IE11 `Math.trunc` and `Number.isInteger` polyfills only in `array.full.es5.js`, so the modern bundles no longer trigger Lighthouse's "Legacy JavaScript" audit.
