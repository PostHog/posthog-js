---
'posthog-js': patch
---

fix(replay): discard the prior session's buffer when start() bails out a pending stop(). On a stopSessionRecording() → reset() → identify(newUser) → startSessionRecording() sequence, stopSessionRecording() takes the async compression-drain path, deferring its buffer flush and teardown. start() correctly invalidates that pending cleanup so the new recorder survives, but it left the stopped session's snapshot buffer in place. The re-entrant session-id restart then flushed those previous-user snapshots under the OLD session id, producing a mixed-distinct_id session that server-side `any(distinct_id)` attribution resolves to the wrong person — recordings showing the previous user's identity. start() now clears that stale buffer alongside invalidating the compression queue, matching the drop-trailing-data trade-off the bailed-out stop() path already accepts.
