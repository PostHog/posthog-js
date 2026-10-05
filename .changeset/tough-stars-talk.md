---
'posthog-react-native': minor
---

Attach `$recording_status` and the replay trigger and buffer `$sdk_debug_*` properties to every captured event, and the rest of the session replay debug properties to SDK events at most once every 30 seconds, reading the native replay state (`buffering`, hold reason, buffer length) from `@posthog/react-native-plugin` 2.12.0 or newer
