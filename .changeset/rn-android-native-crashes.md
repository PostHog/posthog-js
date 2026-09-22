---
'@posthog/react-native-plugin': patch
---

Capture Android native (NDK) crashes on Android 12+ when `errorTracking.autocapture.nativeCrashes` is enabled, reported on the next app launch (including recent crashes from before the upgrade).
