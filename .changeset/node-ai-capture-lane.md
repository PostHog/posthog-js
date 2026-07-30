---
'@posthog/core': minor
'posthog-node': minor
'@posthog/ai': minor
---

Add an internal-only dedicated AI capture lane: posthog-node `_captureAi()` posts to `/i/v0/ai/batch/` on an isolated queue route with an 8MiB per-event cap, byte-aware sub-batching, and in-lane 413 handling that never touches the shared analytics batching.
`@posthog/ai` wrappers route through the lane when a client opts in via `_useAiLane` / `_enableMultimodalCapture`; multimodal passthrough skips media redaction and truncation per client, replacing the `_INTERNAL_LLMA_MULTIMODAL` env var (the OTel export path now always redacts).
