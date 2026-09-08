---
'posthog-js': minor
---

Add `posthog-js/full`, `posthog-js/no-external` and `posthog-js/full/no-external` entry points, so desktop apps and other CSP-restricted builds can `require` a bundle instead of deep-importing an ES module from `dist/`
