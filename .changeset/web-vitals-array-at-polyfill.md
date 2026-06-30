---
'posthog-js': patch
---

Fix `TypeError: ....at is not a function` thrown by the bundled `web-vitals` dependency on browsers that predate `Array.prototype.at()` (Chrome <92, iOS Safari <15.4). The web-vitals entrypoints now install a tiny `Array.prototype.at` polyfill before web-vitals runs, so web vitals capture works again on older browsers instead of crashing with an unhandled error.
