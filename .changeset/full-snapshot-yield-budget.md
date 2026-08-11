---
'posthog-js': minor
'@posthog/types': patch
'@posthog/rrweb': patch
'@posthog/rrweb-snapshot': patch
---

Adds the opt-in `session_recording.fullSnapshotYieldBudgetMs` config. On pages with very large DOMs the recorder's full snapshot otherwise serializes the whole tree in one synchronous main-thread pass, freezing the page for seconds. With a budget set, serialization is time-sliced: the recorder yields to the event loop whenever it has spent the configured milliseconds of continuous main-thread work, while producing a node-identical snapshot through the same serialization path the synchronous snapshot uses. The default (0) keeps the previous fully-synchronous behavior.

What is guaranteed while a sliced snapshot is in flight:

- Mutation buffers stay locked for the whole walk. Mutations observed during it are delivered by the buffer commit that runs after the FullSnapshot, stamped at commit time.
- Non-mutation events (clicks, inputs, scrolls, custom events) are held and delivered after the FullSnapshot, each keeping the timestamp it was observed at. An explicit allowlist of order-independent SDK control events (session lifecycle, visibility, online/offline, pause/resume) and console-plugin output bypasses the hold and delivers immediately, because those carry no mirror node ids and lose their value when late.
- Ordering caveats: there is no observation-order guarantee between held events and locked-buffer mutations (a mutation observed before a click can reach the wire after it, at commit time). A held event that references a node only the commit will introduce is deferred past the commit and re-stamped at flush time. The FullSnapshot itself is stamped at walk start while each node is serialized at visit time, so a late-visited node contributes later state to an earlier-stamped snapshot. Final DOM state converges; the incremental trail inside the walk window is not observation-ordered.
- If the snapshot cannot complete within its safety limits (held-event overflow, mutation backlog, or the wall-clock watchdog), the recorder retries once and then falls back to a synchronous snapshot. An abort drops what cannot survive it: held mutation payloads, and events referencing ids no serialization ever claimed. Every drop is counted and reported on the wire as `budgeted-full-snapshot` custom events (`droppedHeldEventCount`, `carriedHeldEventCount`, `failedHeldEventDeliveries`, plus a `mutation-commit-incomplete` diagnostic for commit losses), alongside a `completed` success diagnostic carrying slice telemetry.

Additional caveats:

- A held interaction targeting a node that was removed mid-walk before the walker reached it cannot be rendered by the replayer (its id is absent from the new snapshot); it is dropped and counted in `droppedHeldEventCount` rather than delivered dangling.
- Held events carried across an abort into the retry walk have their timestamps clamped to the retry snapshot's timestamp, keeping the wire monotonic at the cost of exact observation timing for that window.
- For canvases recorded in command mode (`sampling: 'all'`, not used by posthog-js), commands observed during the walk before a canvas's pixels were baked into the snapshot are discarded as contained in the bake; on an abort, pending commands for masked or WebGL canvases (whose pixels are never baked) are lost until the next keyframe.

The budget is cooperative, not a hard bound: a single large stylesheet, canvas, or same-origin iframe still serializes without an internal yield.
