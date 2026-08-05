---
"posthog-react-native": minor
"@posthog/react-native-plugin": minor
---

Add push notification support, so PostHog Workflows can target React Native apps.

With `@posthog/react-native-plugin` installed, device tokens register automatically on iOS and Android, and notification opens are captured as `$push_notification_opened`. Both are on by default; opt out with `capturePushNotificationSubscriptions: false` or `capturePushNotificationOpened: false`.

- `registerPushNotificationToken` and `unregisterPushNotificationToken` handle token refreshes and manual control.
- `capturePushNotificationOpened` covers the warm-start opens that auto-detection cannot see.
- `pushIdentityProvider` mints a signed token for projects that require identity-verified subscriptions.
- An opted-out user registers no token, and consent changes propagate to the native SDK at runtime: `optOut()` stops native auto-registration (e.g. on an OS token refresh) and requests removal of an already-registered subscription. Known limitation: the native SDKs gate that removal on their own consent state, so deleting an existing subscription may not complete until the next opted-in launch, and `optIn()` does not refetch a token on its own yet — tracked in PostHog/posthog-android#675 and PostHog/posthog-ios#746.
- `reset()` now propagates to the native SDK: it unregisters the logged-out user's subscription and re-registers under the new identity. The re-registration can briefly race the identity handoff on both platforms; the native SDKs converge it on the next flush.
