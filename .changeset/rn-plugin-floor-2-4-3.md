---
'posthog-react-native': patch
---

Fix session replay started with `startRecording()` capturing nothing on Android by requiring `@posthog/react-native-plugin` 2.4.3 or newer.
