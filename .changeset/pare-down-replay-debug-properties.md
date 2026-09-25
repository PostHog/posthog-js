---
'posthog-js': patch
---

Session replay adds fewer `$sdk_debug_*` properties to captured events: only the ones the replay capture diagnostics read. `$feature_flag_called`, `$$heatmap`, and `time to see data` events no longer get replay debug properties.
