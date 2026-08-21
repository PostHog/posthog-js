---
'posthog-react-native': patch
'@posthog/core': patch
---

Fix buffered logs being dropped instead of retried after HTTP 408, 429 or 5xx
