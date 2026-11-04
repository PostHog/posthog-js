---
'posthog-js': patch
---

`posthog.metrics` drops a counter, gauge, or histogram recorded after `posthog.shutdown()`. A late sample no longer restarts the metrics flush timer.
