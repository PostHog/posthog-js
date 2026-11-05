---
'posthog-js': minor
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

`metrics.histogram()` accepts a `bounds` option that sets the histogram's bucket boundaries, and `beforeSend` sees and can change them. The first sample of a histogram (name and unit) fixes its bounds until the client resets. A later sample with different bounds is recorded in the fixed buckets and logs a warning, and a sample with invalid bounds is dropped. The experimental `posthog.flags.request.duration` histogram now uses the bounds `[50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000]` ms, so its p50 and p95 resolve between 50ms and 5s. This changes the metric's buckets, which its experimental status allows.
