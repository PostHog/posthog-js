---
"posthog-react-native": minor
"@posthog/react-native-plugin": minor
---

Add push notification support, so PostHog Workflows can target React Native apps.

With `@posthog/react-native-plugin` installed, device tokens register automatically on iOS and Android, and notification opens are captured as `$push_notification_opened`. Both are on by default; opt out with `capturePushNotificationSubscriptions: false` or `capturePushNotificationOpened: false`.

- `registerPushNotificationToken` and `unregisterPushNotificationToken` handle token refreshes and manual control.
- `capturePushNotificationOpened` covers the warm-start opens that auto-detection cannot see.
- `pushIdentityProvider` mints a signed token for projects that require identity-verified subscriptions.
- An opted-out user registers no token, and consent changes propagate to the native SDK at runtime: `optOut()` unregisters a subscription that was already registered and stops native auto-registration (e.g. on an OS token refresh), and `optIn()` re-arms it without an app restart.
- `reset()` now propagates to the native SDK: it unregisters the logged-out user's subscription and re-registers under the new anonymous ID.
