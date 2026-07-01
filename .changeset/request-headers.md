---
'posthog-react-native': minor
'@posthog/react-native-plugin': patch
---

Add a `requestHeaders` option to send custom headers (e.g. `Authorization`) with SDK requests, including session replay and native error/crash uploads via the native plugin. Useful for reverse-proxy setups that require authentication.
