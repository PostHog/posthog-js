---
'@posthog/react-native-plugin': patch
'posthog-react-native': patch
---

Count a PostHog notification tap once when both `capturePushNotificationOpened` and automatic capture report it, using the dedupe added in `posthog-android` 3.65.0 and `posthog-ios` 3.75.0. Update the native SDKs to `posthog-android` 3.65.2 and `posthog-ios` 3.75.2.
