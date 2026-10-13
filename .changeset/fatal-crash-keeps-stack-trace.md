---
'posthog-react-native': patch
---

Fix fatal crashes being reported without a stack trace since 4.77.0 when a stack frame has no chunk ID.
