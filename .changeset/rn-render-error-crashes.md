---
'posthog-react-native': patch
'@posthog/react-native-plugin': patch
---

Report fatal JS crashes the JS error handler did not capture, such as React render errors on iOS, through native crash capture instead of dropping them (requires updating both `posthog-react-native` and `@posthog/react-native-plugin`). Apps with `errorTracking.autocapture.nativeCrashes` on and `uncaughtExceptions` off now get every fatal JS crash reported this way.
