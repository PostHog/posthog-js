---
'@posthog/ai': minor
---

Replace otel client-side span mapping with PostHogTraceExporter. PostHog now converts gen_ai.* spans into $ai_generation events server-side, so the client-side mapper pipeline (PostHogSpanProcessor, captureSpan, aiSdkSpanMapper) has been replaced with a simple OTLPTraceExporter wrapper.
