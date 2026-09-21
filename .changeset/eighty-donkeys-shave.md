---
'posthog-js': patch
---

Session replay network capture no longer fails to start in frames without `PerformanceObserver` or its `supportedEntryTypes`; those frames record without live network timing.
