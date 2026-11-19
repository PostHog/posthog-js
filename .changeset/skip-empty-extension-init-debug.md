---
'posthog-js': patch
---

Only register `$sdk_debug_extensions_init_method` and `$sdk_debug_extensions_init_time_ms` when extensions were loaded and their initialization took measurable time.
