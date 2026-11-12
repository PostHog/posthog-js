---
'posthog-react-native': minor
---

- Add `captureAi()`, which sends AI observability events such as `$ai_generation` to PostHog's AI endpoint (`/i/v1/ai/events`) from their own queue, with the `captureAiCompression`, `captureAiMaxQueueSize`, `captureAiTimeout` and `captureAiMaxEventBytes` options — serve `/i/v1/ai/events` on reverse proxies and self-hosted instances
- `capture()` keeps sending `$ai_*` events to the analytics endpoint; use `captureAi()` for them
