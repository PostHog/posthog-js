---
'posthog-react-native': minor
'@posthog/react-native-plugin': minor
---

Add `errorTracking.autocapture.androidNdkCrashes` to capture native C/C++ (NDK) crashes on Android 12+. Crashes are captured on the next app launch and need exception autocapture enabled in the project's error tracking settings. Requires `@posthog/react-native-plugin` 2.10.0 or newer.

`nativeCrashes` keeps covering Java/Kotlin crashes on Android and native crashes on Apple platforms.
