---
'posthog-react-native': patch
---

Add `request_headers` option to send custom headers (e.g. `Authorization`) with SDK requests, matching the browser SDK. Useful for reverse-proxy setups that require authentication.
