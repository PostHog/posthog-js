---
'posthog-js': patch
'@posthog/types': patch
---

fix(metrics): `metrics.network` no longer records server-sent event streams. A `text/event-stream` response stays open for as long as the page listens, so it was timed as a request lasting minutes and pinned the duration percentiles to the top bucket.
