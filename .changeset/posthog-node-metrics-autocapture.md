---
'posthog-node': minor
---

Add `metrics.autocapture`: HTTP, database and runtime metrics from the official OpenTelemetry instrumentations, with no instrumentation code. Start the app with `node --import posthog-node/metrics/register` to measure every library it loads.
