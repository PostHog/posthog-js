---
'@posthog/ai': patch
---

Supports posthog-node 6. Exception autocapture passes an options object to `captureException` when the client is posthog-node 6, and positional arguments for 5.x.
