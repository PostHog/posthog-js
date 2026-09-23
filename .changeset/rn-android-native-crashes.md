---
'posthog-react-native': minor
'@posthog/react-native-plugin': minor
---

Add `errorTracking.autocapture.androidNdkCrashes` to capture native C/C++ (NDK) crashes on Android. Requires Android 12+ and exception autocapture enabled in the project's error tracking settings; crashes are captured on the next app launch and symbolicated against `.so` debug symbols uploaded with the PostHog Gradle plugin. `nativeCrashes` keeps covering Java/Kotlin crashes on Android, and native crashes on Apple platforms.
