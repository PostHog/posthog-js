---
'posthog-node': major
---

Capture always uses capture v1: `POSTHOG_CAPTURE_MODE` is no longer read, `captureAi` sends to `/i/v1/ai/events`, and `CaptureV1Error` is now `CaptureError`.
