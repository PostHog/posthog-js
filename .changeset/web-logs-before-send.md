---
'posthog-js': minor
'@posthog/types': minor
'@posthog/core': minor
'posthog-react-native': patch
---

feat(logs): add a `beforeSend` filter to the web logs API (`logs: { beforeSend }`) to inspect, redact, or drop log records before they are buffered — configurable as a single function or a left-to-right chain (returning `null` drops the record). The programmatic logs API (`posthog.captureLog` / `posthog.logger.*`) now runs through the shared `@posthog/core` logs pipeline, which adds adaptive 413 batch-sizing and per-record retry. A failed flush now retries on its own (first at the flush interval, then exponential backoff) instead of waiting for the next captured log.

Behavior notes for existing web logs users (delivered volume, rate limiting, `service.name`, `maxBufferSize` default of 100, opt-out gating, and the `sendBeacon`-on-unload drain are all unchanged):

- `logs.maxBufferSize` keeps its default of 100 and its meaning: the number of buffered records that triggers a flush. The new pipeline drains asynchronously (records leave the queue only after the server acknowledges them), so during a synchronous burst the queue can grow past `maxBufferSize`; an internal memory backstop set to the per-interval rate cap evicts the oldest only above that. Net effect: bursts the rate cap admits are still delivered in full, exactly as before.
- Records drain in `maxBatchRecordsPerPost` (100) chunks, so under sustained load batches are slightly larger and less frequent than before. Delivered volume is unchanged.
- On page unload the queue is drained via `sendBeacon`. Because records now leave the queue only after the server acknowledges them (rather than synchronously at send time), an unload that coincides with an in-flight flush re-sends that batch — favoring a possible duplicate over the previous risk of losing an in-flight batch that the navigation cancelled.
