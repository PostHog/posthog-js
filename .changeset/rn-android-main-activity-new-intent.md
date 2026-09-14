---
'posthog-react-native': minor
---

Fix `$push_notification_opened` not being captured on Android when the app's process was killed but its task stayed in recents (opt out with `{ patchMainActivityNewIntent: false }`).
