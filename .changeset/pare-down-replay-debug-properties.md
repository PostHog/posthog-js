---
'posthog-js': patch
---

Session replay adds fewer `$sdk_debug_*` properties to captured events: only the ones the replay capture diagnostics read. Only SDK events (names that start with `$`) get replay debug properties, `$feature_flag_called` and `$$heatmap` events no longer get them, and they are added at most once every 30 seconds per session.
