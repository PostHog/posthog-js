---
'posthog-js': patch
---

fix(replay): session recording no longer throws `TypeError: Converting circular structure to JSON` when replay event data contains a circular reference. The circular-reference guard now also detects cycles that pass through an array, and affected events are captured with `[Circular]` markers instead of surfacing an unhandled error and being dropped.
