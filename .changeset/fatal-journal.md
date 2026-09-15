---
'posthog-react-native': minor
'@posthog/react-native-plugin': minor
---

fix(react-native): recover fatal JS exceptions lost when AsyncStorage persistence is interrupted. Adds a bounded native fatal-report journal to `@posthog/react-native-plugin` (Android + iOS): one atomic file per pending fatal exception under the app's private storage, capped at 5 entries, with corrupt-file cleanup. The fatal JS handler persists a bounded snapshot to the native journal alongside the JS queue and waits for both under the existing 2 s deadline. On the next SDK launch the journal is drained through the existing capture path with the original event UUID + timestamp so server-side dedup can collapse duplicates; the original `distinct_id`, `$session_id`, and `$device_id` survive via transient overrides. A bounded FIFO seen-ids set prevents re-capturing after a crash between JS persist and native remove. Older plugins and older `@posthog/core` from npm fall back to the existing JS-only wait unchanged.