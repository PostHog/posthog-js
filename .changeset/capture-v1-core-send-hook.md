---
'@posthog/core': patch
---

Extract the `/batch/` submission out of `_flush()` and `sendImmediate()` into a single overridable `protected sendBatch()` seam on `PostHogCoreStateless`, and widen `requestTimeout`/`historicalMigration` to `protected`. Add an overridable queue-route seam (`getQueueRouteKey`, `persistedQueueKeyForRoute`, `getActiveQueueRoutes`) so a subclass can partition events across independent queues that batch, flush, retry, and persist separately, plus an `AiQueue` persisted-property key and a `route` argument on `sendBatch`. This is an internal, behavior-preserving refactor — with the default single route the enqueue/flush/shutdown/reset paths are byte-identical (v0 request shape, retry, 413 handling, and error surfacing unchanged), so browser and React Native are unaffected. Groundwork for opt-in Capture V1 support in `posthog-node`, where `$ai_*` events stay on the legacy transport isolated from the V1 route.
