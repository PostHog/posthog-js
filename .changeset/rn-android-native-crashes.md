---
'posthog-react-native': minor
'@posthog/react-native-plugin': minor
---

Add `errorTracking.autocapture.androidNdkCrashes` to capture native C/C++ (NDK) crashes on Android 12+ (requires `@posthog/react-native-plugin` 2.12.0). Update `posthog-android` to 3.71.1 so these crashes are stamped at the right time when the device clock disagrees with network time.
