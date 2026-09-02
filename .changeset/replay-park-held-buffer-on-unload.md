---
'posthog-js': patch
---

Session replay no longer loses the start of a recording when a page unloads while a timing gate holds the buffer. The minimum-duration gate and the markers-only gate both hold the buffer for a retry that an unloading page never runs, so the buffered snapshots died with the page. They are now parked in `sessionStorage` and picked up by the next page in the same tab, which keeps the configured minimum duration intact: a session that really ended on that page still ships nothing
