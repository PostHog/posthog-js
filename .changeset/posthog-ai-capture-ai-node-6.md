---
'@posthog/ai': minor
---

With posthog-node 6, every AI event is sent through `captureAi` on the capture v1 AI lane, and `enableFullAiCapture` only controls truncation and media redaction. With posthog-node 5, nothing changes: AI events use `capture` unless `enableFullAiCapture` is set.
