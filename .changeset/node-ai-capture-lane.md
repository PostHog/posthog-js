---
'@posthog/core': minor
'posthog-node': minor
'@posthog/ai': minor
---

Add a dedicated AI capture lane. posthog-node gains internal-only `_captureAi()` / `_captureAiImmediate()` posting to `/i/v0/ai/batch/` on an isolated queue route with an 8MiB per-event ceiling and byte-aware sub-batching, plus `_useAiLane` and `_enableMultimodalCapture` client options. `@posthog/ai` wrappers route through the lane when the client opts in, and multimodal capture (which implies the lane) now skips base64 media redaction and size truncation per client, replacing the `_INTERNAL_LLMA_MULTIMODAL` env var. Core gains two additive protected seams: an explicit-route override on `enqueue`/`sendImmediate` and a per-route batch endpoint path. Analytics capture behavior is unchanged; `capture()` is never rerouted by event name.

Lane delivery is at-least-once: a non-413 failure partway through a multi-sub-batch send can re-deliver sub-batches already accepted by the server on retry. Lane 413s are now handled in-lane by bisecting the offending sub-batch and retrying the halves, dropping only single events the server's cap can never accept regardless of size — core's shared `maxBatchSize` halving never fires for the lane.
