---
'@posthog/ai': minor
---

Fix `@posthog/ai/otel` dropping every AI trace on Cloudflare Workers and other edge runtimes. The OTLP export path now posts with `fetch` instead of `@opentelemetry/exporter-trace-otlp-http`, whose browser build needs `XMLHttpRequest` or `sendBeacon`. `@opentelemetry/exporter-trace-otlp-http` is no longer a peer dependency, so `PostHogTraceExporter` no longer extends `OTLPTraceExporter`; it still implements `SpanExporter`.
