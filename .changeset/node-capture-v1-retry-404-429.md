---
'posthog-node': patch
---

With `POSTHOG_CAPTURE_MODE=v1`, capture now retries `404` and `429` responses like `408` and `5xx` instead of failing the batch at once.
