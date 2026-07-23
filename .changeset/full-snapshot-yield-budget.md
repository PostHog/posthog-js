---
'@posthog/rrweb-snapshot': minor
'@posthog/rrweb': minor
'@posthog/rrweb-record': patch
'@posthog/types': patch
'posthog-js': patch
---

The recorder can now take time-sliced full snapshots via the new opt-in `fullSnapshotYieldBudgetMs` config (exposed as `session_recording.fullSnapshotYieldBudgetMs`). On pages with very large DOMs the full snapshot otherwise serializes the whole tree in one synchronous main-thread pass, freezing the page for seconds; with a budget set, serialization yields to the event loop whenever it has spent the configured milliseconds of continuous main-thread time, while producing a node-identical snapshot — same ids, structure and semantic flags, because the sliced walker serializes every node through the same code path incremental mutation adds already use. Mutation buffers stay locked across the sliced snapshot and buffered mutations re-apply against the newly built mirror on unlock, exactly as in the synchronous path; id-bearing incremental events arriving mid-snapshot are dropped for the duration (reproducing the synchronous semantics, where nothing can interleave with the snapshot's long task) while id-free custom/plugin events are queued and flushed after the FullSnapshot. The default (0) keeps the previous fully-synchronous behavior.
