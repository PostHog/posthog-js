---
"@posthog/ai": minor
---

Add `PostHogSpanProcessor` as a self-contained OpenTelemetry `SpanProcessor` that handles batching and export internally. Both `PostHogSpanProcessor` and `PostHogTraceExporter` now automatically filter to AI-related spans only (`gen_ai.*`, `llm.*`, `ai.*`, `traceloop.*`).
