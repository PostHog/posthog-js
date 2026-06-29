---
'posthog-js': patch
---

Include a Promise polyfill in the IE11 bundle and avoid Promise-dependent async compression paths when Promise support is unavailable.
