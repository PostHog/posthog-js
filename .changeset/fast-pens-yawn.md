---
'posthog-js': patch
'@posthog/types': patch
---

perf(replay): reduce memory and CPU cost of event compression by caching gzipped empty arrays and eliminating redundant JSON.stringify for size estimation
