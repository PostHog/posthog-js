---
'@posthog/core': patch
---

Extract the `/batch/` submission out of `_flush()` and `sendImmediate()` into a single overridable `protected sendBatch()` seam on `PostHogCoreStateless`, and widen `requestTimeout`/`historicalMigration` to `protected`. This is an internal, behavior-preserving refactor (v0 request shape, retry, 413 handling, and error surfacing are unchanged) that lets a subclass swap the capture transport for both the batched and immediate send paths at once. Groundwork for opt-in Capture V1 support in `posthog-node`.
