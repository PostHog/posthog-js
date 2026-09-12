---
'posthog-react-native': minor
---

Fix `$push_notification_opened` not being captured on Android when the app's process was killed but its task stayed in recents — the Expo config plugin now adds a `MainActivity.onNewIntent` override (opt out with `{ patchMainActivityNewIntent: false }`).
