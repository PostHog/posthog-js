---
'posthog-node': minor
---

Proof of concept: autocapture low-level Node runtime metrics (CPU, memory, event loop delay and utilization, GC pauses, uptime, active handles) through `posthog.metrics`, with no instrumentation. Off unless the `metrics-sdk-autocapture` feature flag opens the gate (evaluated locally only, so it costs no request and no event) or `enableMetricsAutocapture: true` is set.
