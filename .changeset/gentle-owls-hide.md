---
'posthog-js': patch
---

Prevent uncaught `getComputedStyle` crashes in heatmaps and autocapture when the event target is a cross-realm element (e.g. from an iframe or synthetic event)
