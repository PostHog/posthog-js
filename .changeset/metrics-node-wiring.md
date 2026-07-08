---
'posthog-node': minor
'@posthog/core': minor
---

add the posthog.metrics API (count, gauge, histogram) to posthog-node — alpha

Backend services can now record metrics through the same statsd-style pre-aggregating client the browser SDK ships, with no OpenTelemetry setup:

```ts
const client = new PostHog('phc_...', { metrics: { serviceName: 'billing-worker' } })
client.metrics.count('invoices.processed', 1, { attributes: { plan: 'pro' } })
client.metrics.gauge('queue.depth', 42)
client.metrics.histogram('job.duration', 187, { unit: 'ms' })
```

Samples aggregate in memory and flush as OTLP/JSON to `/i/v1/metrics` (one data point per series per window). Pending metrics are flushed on `shutdown()`. Core gains `_sendMetricsBatch` on `PostHogCoreStateless` (same outcome contract as `_sendLogsBatch`) and a shared `resolveMetricsConfig`, so any core-based SDK can host `PostHogMetrics`.
