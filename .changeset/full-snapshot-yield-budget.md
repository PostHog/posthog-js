---
'posthog-js': minor
'@posthog/types': patch
---

Adds the opt-in `session_recording.fullSnapshotYieldBudgetMs` config. On pages with very large DOMs the recorder's full snapshot otherwise serializes the whole tree in one synchronous main-thread pass, freezing the page for seconds. With a budget set, serialization is time-sliced: the recorder yields to the event loop whenever it has spent the configured milliseconds of continuous main-thread work, while producing a node-identical snapshot through the same serialization path the synchronous snapshot uses. Mutation buffers stay locked across the sliced snapshot, and every event observed while it is in flight is held and delivered after the FullSnapshot in observation order — nothing is dropped. If the snapshot cannot complete within its safety limits (held-event overflow or the wall-clock watchdog) the recorder falls back to a synchronous snapshot and reports the degradation as a custom event. The budget is cooperative, not a hard bound: a single large stylesheet, canvas, or same-origin iframe still serializes without an internal yield. The default (0) keeps the previous fully-synchronous behavior.
