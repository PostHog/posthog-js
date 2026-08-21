---
'posthog-js': patch
'@posthog/types': patch
---

feat: add granular automatic pageview options for SPA navigation

`capture_pageview` now accepts an object with `path`, `search`, and `hash` options. Each selected URL component triggers a `$pageview` when it changes, including direct hash changes used by hash-based routers. The existing `'history_change'` option continues to capture pathname changes.
