---
'@posthog/react-native-plugin': patch
'posthog-react-native': patch
---

Capture `$push_notification_opened` on iOS when a notification tap cold-launches the app, attributed to the launch's own user. Set `com.posthog.posthog.CAPTURE_PUSH_NOTIFICATION_OPENED` to `false` in `Info.plist` to skip the launch hook and force `capturePushNotificationOpened` off, matching posthog-flutter; `capturePushNotificationOpened: false` alone still sends nothing, but installs the hook until `setup()` releases it.
