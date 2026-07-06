---
'posthog-js': patch
---

fix(web): stop retrying log batches forever when requests die before an HTTP response (status 0, e.g. an ad blocker) — after 3 consecutive such failures while the browser reports itself online, the logs pipeline stops sending and drops batches instead of buffering and retrying for the life of the page; the `online` event reopens it, and genuine offline periods still queue for the reconnect flush
