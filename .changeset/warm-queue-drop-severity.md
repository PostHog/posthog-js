---
'@posthog/core': patch
---

Log a `warn` (previously `info`) when the local event queue is full and the oldest event is dropped, matching the severity Python and Rust already use for this condition.
