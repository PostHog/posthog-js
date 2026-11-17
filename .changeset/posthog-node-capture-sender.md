---
'posthog-node': major
---

Capture retries only 404, 408, 429, 500, 502, 503, 504 and network errors, waiting 100 ms doubled per retry with jitter (at most 30 s, at least `Retry-After`).
Adds `captureMaxRetries`, `captureCompression`, `captureAiCompression`, `captureAiMaxQueueSize` and `captureAiRequestTimeoutMs`.
