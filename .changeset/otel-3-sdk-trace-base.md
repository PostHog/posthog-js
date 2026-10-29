---
'@posthog/ai': patch
---

Fix `@posthog/ai/otel` so that it loads with OpenTelemetry JS 3.x, which has no `@opentelemetry/sdk-trace-base`.
