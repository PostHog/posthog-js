---
"@posthog/ai": patch
---

Wrap the OpenAI/Azure `responses.stream()` method so `posthogTraceId` (and the other `posthog*` params) are stripped before reaching the API and the streamed generation is captured. Previously `responses.stream()` was unwrapped, so a top-level `posthog_trace_id` caused a `400 Unknown parameter` and the generation was never associated with a trace.
