---
'posthog-js': patch
---

fix(replay): guard the session-recording compression path against circular references. `gzipToString`/`gzipToStringAsync` now serialize with the same `circularReferenceReplacer` already used by `estimateSize`, so an event whose data contains a circular reference compresses gracefully (with `[Circular]` markers) instead of throwing `TypeError: Converting circular structure to JSON`. The async compression queue is also hardened so a serialization failure can never surface as an unhandled rejection and drop recording events for the session.
