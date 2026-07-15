---
'posthog-node': minor
---

Raise the default `maxQueueSize` from 1000 to 10000. Backend workloads are more likely to burst-enqueue events synchronously ahead of a flush than browser/mobile clients, so the previous default risked silently dropping events under bursty load. An explicit `maxQueueSize` option still overrides this default.
