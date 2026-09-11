---
'posthog-js': patch
'@posthog/types': patch
---

Back off automatic feature flag refreshes on idle visible pages only when `remote_config_refresh_interval_ms` is omitted, preserving explicitly configured intervals.
