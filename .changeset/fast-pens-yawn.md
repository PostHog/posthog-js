---
'posthog-js': patch
---

perf(replay): reduce memory and CPU cost of event compression by caching gzipped empty arrays, eliminating redundant JSON.stringify for size estimation
