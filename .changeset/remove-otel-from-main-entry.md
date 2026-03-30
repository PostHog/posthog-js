---
"@posthog/ai": patch
---

Remove PostHogTraceExporter from the main entry point to avoid crashing when @opentelemetry/exporter-trace-otlp-http is not installed. Use `@posthog/ai/otel` to import it instead.
