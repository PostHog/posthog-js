---
'@posthog/react-native-plugin': patch
---

Fix fatal JS errors being double-reported on Android in minified release builds: the plugin's dedup matched serialized class-name strings, which R8/ProGuard renaming can defeat. It now registers `JavascriptException` in posthog-android's `errorTrackingConfig.ignoredExceptionTypes` (requires core 6.24.0), which matches by class across the cause chain and is unaffected by minification.
