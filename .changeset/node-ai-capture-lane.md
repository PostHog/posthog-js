---
'@posthog/core': minor
'posthog-node': minor
'@posthog/ai': minor
---

Public beta `captureAi()` / `captureAiImmediate()`: AI events on a dedicated isolated endpoint with the event UUID returned. New `enableFullAiCapture` option replaces the internal `_useAiLane` / `_enableMultimodalCapture`; wrappers route through the AI endpoint and skip redaction/truncation when set (privacy mode still wins).
