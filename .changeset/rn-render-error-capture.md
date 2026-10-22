---
'posthog-react-native': patch
---

Fix React render errors that crash the app not being captured on React Native 0.78 and newer when `errorTracking.autocapture.uncaughtExceptions` is enabled.
