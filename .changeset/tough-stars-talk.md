---
'posthog-react-native': minor
---

Attach `$recording_status` and `$sdk_debug_*` session replay debug properties to every captured event, reading the native replay state (`buffering`, hold reason, buffer length) from `@posthog/react-native-plugin` 2.12.0 or newer
