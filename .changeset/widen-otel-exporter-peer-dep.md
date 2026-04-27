---
'@posthog/ai': patch
---

Widen the `@opentelemetry/exporter-trace-otlp-http` peer dependency range from `^0.200.0` (which only matched `0.200.x`) to `>=0.200.0 <1.0.0`, so newer 0.x releases brought in by other OpenTelemetry-aware packages no longer trigger ERESOLVE failures or require `--legacy-peer-deps`.
