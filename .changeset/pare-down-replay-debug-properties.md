---
'posthog-js': patch
---

Session replay adds fewer `$sdk_debug_*` properties to captured events: only the ones the replay capture diagnostics read. `$feature_flag_called`, `$$heatmap`, `time to see data`, and `livestream_*` events no longer get replay debug properties.
