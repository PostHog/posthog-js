---
'@posthog/react-native-plugin': patch
'posthog-react-native': patch
---

Capture `$push_notification_opened` on iOS when a notification tap cold-launches the app, or set `com.posthog.posthog.CAPTURE_PUSH_NOTIFICATION_OPENED` to `false` in `Info.plist` to opt out before any PostHog code runs, as in posthog-flutter.
