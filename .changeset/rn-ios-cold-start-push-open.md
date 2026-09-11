---
'@posthog/react-native-plugin': patch
---

Fix `$push_notification_opened` not being captured on iOS when a notification tap cold-launches the app (requires posthog-ios 3.72.0; set `com.posthog.posthog.CAPTURE_PUSH_NOTIFICATION_OPENED` to `false` in Info.plist to opt out).
