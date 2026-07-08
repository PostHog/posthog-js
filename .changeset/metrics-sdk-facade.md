---
'posthog-js': minor
'@posthog/core': minor
'@posthog/types': minor
---

add the posthog.metrics API (count, gauge, histogram) — alpha

A statsd-style pre-aggregating metrics client for the PostHog Metrics product (alpha). Samples are folded into per-series aggregates in memory (counts sum, gauges keep the last value, histograms accumulate buckets) and flushed periodically as OTLP/JSON to `/i/v1/metrics` — one data point per series per flush window, no matter how many calls. No OpenTelemetry SDK setup required:

```ts
posthog.metrics.count('orders_created', 1)
posthog.metrics.gauge('active_connections', 42)
posthog.metrics.histogram('api_latency', 187, { unit: 'ms' })
```

Configure via `metrics: { serviceName, environment, flushIntervalMs, maxSeriesPerFlush, beforeSend, ... }`.
