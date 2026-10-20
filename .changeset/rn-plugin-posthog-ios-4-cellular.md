---
'@posthog/react-native-plugin': patch
---

Pause iOS native uploads (session replay, native crash reports) while cellular data is turned off for the app, instead of sending requests that fail
