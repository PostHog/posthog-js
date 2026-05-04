---
"@posthog/core": patch
"posthog-react-native": patch
---

Do not crash when the React Native SDK is initialized without an API key; initialize as disabled and log an error instead. Disabled clients now also skip manual reload/flush/survey/log network calls.
