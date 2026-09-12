---
'@posthog/react-native-plugin': patch
'posthog-react-native': patch
---

Require posthog-android 3.65.0 and posthog-ios 3.75.0 so a manual `capturePushNotificationOpened` call for a PostHog notification tap the SDK already captured is counted once on both platforms.
