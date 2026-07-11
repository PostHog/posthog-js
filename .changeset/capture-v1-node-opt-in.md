---
'posthog-node': minor
---

Add opt-in Capture V1 support. Set the `POSTHOG_CAPTURE_MODE=v1` environment variable to submit analytics events to the Capture V1 endpoint (`/i/v1/analytics/events`) instead of the legacy `/batch/` endpoint, on both the batched and immediate send paths. The default remains `v0`, so existing behavior is unchanged unless you opt in. Opt-in is env-var-only during the transition (no public option), so nothing on the API surface has to be removed when v1 later becomes the default.

Capture V1 uses Bearer auth, lifts legacy `$`-sentinel properties into a typed `options` object, and does per-event partial retry with exponential backoff clamped against `Retry-After`. Dropped and undelivered events are surfaced on the client `error` channel as a `CaptureV1Error`. `$ai_*` events continue to use the legacy submitter for now, regardless of the capture mode.

In `v1` mode, `$ai_*` events are routed to an isolated in-memory queue and flushed independently of the Capture V1 queue, so the two transports never share a batch and a failure on one cannot re-send events already accepted on the other. Each queue keeps its own retry/durability semantics: the legacy queue re-queues on network failure (retrying on later flushes), while the V1 queue exhausts the sender's own attempt budget per cycle and then surfaces the failure rather than re-queuing.
