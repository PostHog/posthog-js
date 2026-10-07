---
'@posthog/react-native-plugin': major
---

**Breaking:** ignore `iOSdebouncerDelayMs` and `androidDebouncerDelayMs` when calling `setup()` directly — pass `throttleDelayMs` instead (posthog-react-native still maps them)
