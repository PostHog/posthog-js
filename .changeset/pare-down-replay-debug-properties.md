---
'posthog-js': patch
---

Session replay adds fewer `$sdk_debug_*` properties to captured events: only the ones the replay capture diagnostics read. `$feature_flag_called` and `$$heatmap` events no longer get replay debug properties.
