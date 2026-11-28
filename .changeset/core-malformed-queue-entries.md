---
'@posthog/core': patch
---

Fix event delivery stopping when the stored event queue held a malformed entry, such as `null` or an entry whose event isn't an object: those entries are now dropped with a warning, and the rest of the queue is sent
