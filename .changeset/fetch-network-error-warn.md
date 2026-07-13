---
'posthog-js': patch
---

Log benign network-level fetch failures from posthog-js's own request layer at `warn` instead of `error`. When an outbound request fails at the network layer (ad blocker, dropped connection, CORS, page teardown), the browser rejects it with a generic `TypeError` (`Failed to fetch`, Firefox's `NetworkError...`, or Safari's `Load failed`). These are already caught and retried by the request queue, so `_fetch` now routes them through `logger.warn` — the same treatment as our own timeout aborts — keeping them out of error tracking's console-error capture. Genuine, unexpected errors still log at `error`.
