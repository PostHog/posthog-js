---
"posthog-js": patch
---

fix: skip deep copy for snapshot/exception events to prevent stack overflow on deeply nested DOM trees
