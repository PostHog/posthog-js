---
'posthog-react-native': minor
'@posthog/react-native-plugin': minor
---

Capture fatal React Native JavaScript exceptions through the embedded native SDK, which persists them to its own disk queue synchronously, so a crash is not lost when the process terminates before AsyncStorage finishes writing. The JS queue copy is dropped when native takes the event, so each crash is still sent once.

Enabling `errorTracking.autocapture.uncaughtExceptions` now initializes the native PostHog SDK on its own, since that queue is what makes the fatal path durable. Apps that previously enabled neither session replay, native crash autocapture nor push will see one additional `/config` request per launch as a result: the native SDKs fetch remote config at setup regardless of `preloadFeatureFlags`.
