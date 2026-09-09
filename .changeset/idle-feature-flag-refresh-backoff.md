---
'posthog-js': patch
'@posthog/types': patch
---

Reduce the automatic feature flag refresh on visible pages that get no user interaction. The interval doubles up to one hour while the page is idle, and returns to `remote_config_refresh_interval_ms` (5 minutes by default) on the next interaction. Set that option to `0` to stop the background refresh completely.
