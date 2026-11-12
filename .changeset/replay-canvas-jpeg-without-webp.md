---
'posthog-js': patch
---

Session replay: in browsers that cannot encode WebP (Safari), send opaque canvas frames as JPEG at the configured quality instead of the lossless PNG the browser falls back to
