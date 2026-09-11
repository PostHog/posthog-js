---
'@posthog/react-native-plugin': patch
'posthog-react-native': patch
---

Require posthog-android 3.64.0 so a manual `capturePushNotificationOpened` call for a PostHog notification tap the SDK already captured on Android is counted once.
