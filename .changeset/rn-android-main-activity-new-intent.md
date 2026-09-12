---
'posthog-react-native': patch
---

Add an Android `MainActivity.onNewIntent` override through the Expo config plugin so a notification tap is captured when the app's process was killed but its task is still in recents; opt out with `{ patchMainActivityNewIntent: false }`.
