---
'@posthog/react-native-plugin': patch
---

Stop the native SDKs keeping their own opt-out state, so the consent the JS client resolves is the one they use at setup. Requires `posthog-android` 3.66.0 and `posthog-ios` 3.76.0.
