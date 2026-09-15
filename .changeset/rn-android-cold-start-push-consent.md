---
'@posthog/react-native-plugin': patch
---

Android: a notification tap that launched the app is no longer captured as `$push_notification_opened` while the JS client is opted out, even if an earlier launch had opted the native SDK in.
