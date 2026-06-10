---
'posthog-js': patch
'@posthog/rrweb': patch
---

record: capture resting scroll offset on `scrollend` when a reveal scroll clamps to 0 before its target is scrollable (e.g. Silk sheets). Deduped against `scroll` so normal gestures don't double event volume.
