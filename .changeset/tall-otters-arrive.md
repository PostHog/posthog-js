---
"@posthog/react-native-plugin": minor
---

Add the native push notification bridge, so `posthog-react-native` can register device tokens and capture notification opens through the native PostHog SDKs.

- Forwards the push config (`capturePushNotificationSubscriptions`, `capturePushNotificationOpened`) to posthog-ios and posthog-android at setup.
- Bridges `registerPushNotificationToken`, `unregisterPushNotificationToken`, `capturePushNotificationOpened`, `setOptOut`, and `reset` for runtime control from JS.
- Supports a JS `pushIdentityProvider` for projects that require identity-verified subscriptions.
- Captures cold-start notification opens on Android by inspecting the launch Activity's intent at setup, which posthog-android's own lifecycle integration cannot observe in React Native apps.
