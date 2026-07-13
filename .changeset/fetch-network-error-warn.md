---
'posthog-js': patch
---

Log network-level fetch failures from posthog-js's own request layer (ad blocker, dropped connection, CORS, page teardown) at `warn` instead of `error`. The browser rejects these with a generic `TypeError` (`Failed to fetch`, Firefox's `NetworkError...`, or Safari's `Load failed`); they are already caught and retried by the request queue, so they are expected noise rather than SDK errors — `_fetch` now gives them the same `warn` treatment as our own timeout aborts. Genuine, unexpected errors still log at `error`.
