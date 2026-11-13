---
'posthog-node': major
---

Analytics and AI events are batched and sent on separate lanes, in batches of about 5 MiB at most, and events that fail with a network error are kept and retried on the next flush. `flush()` no longer rejects on delivery failures (they arrive through the `'error'` event), and `maxQueueSize` now applies to analytics events only.
