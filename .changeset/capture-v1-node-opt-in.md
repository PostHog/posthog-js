---
'posthog-node': minor
---

Add opt-in Capture V1 support. Set `captureMode: 'v1'` (or the `POSTHOG_CAPTURE_MODE=v1` environment variable) to submit analytics events to the Capture V1 endpoint (`/i/v1/analytics/events`) instead of the legacy `/batch/` endpoint, on both the batched and immediate send paths. The default remains `'v0'`, so existing behavior is unchanged unless you opt in.

Capture V1 uses Bearer auth, lifts legacy `$`-sentinel properties into a typed `options` object, and does per-event partial retry with exponential backoff clamped against `Retry-After`. Dropped and undelivered events are surfaced on the client `error` channel as a `CaptureV1Error`. `$ai_*` events continue to use the legacy submitter for now, regardless of `captureMode`.
