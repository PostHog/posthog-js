---
'@posthog/react-native-plugin': patch
'posthog-react-native': patch
---

Count a PostHog notification tap once when both `capturePushNotificationOpened` and automatic capture report it, by requiring posthog-android 3.65.0 and posthog-ios 3.75.0.
