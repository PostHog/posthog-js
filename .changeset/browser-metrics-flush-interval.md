---
'posthog-js': patch
'@posthog/types': patch
---

fix(metrics): export browser metrics once a minute by default instead of every 10 seconds. Every tab of an app writes to the same series, so busy series exceeded the backend's per-series point limit and were undercounted. An explicit `metrics.flushIntervalMs` still wins.
