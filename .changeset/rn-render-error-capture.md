---
'posthog-react-native': patch
---

Capture React render errors that crash the app on React Native 0.78 and newer as fatal exceptions with their JavaScript stack trace when `errorTracking.autocapture.uncaughtExceptions` is enabled
