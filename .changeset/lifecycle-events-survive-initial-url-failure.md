---
'posthog-react-native': patch
---

`Application Opened`, `Application Backgrounded` and `Application Became Active` are still captured when `Linking.getInitialURL()` rejects.
