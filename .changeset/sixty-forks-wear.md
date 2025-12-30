---
'posthog-react-native': minor
'posthog-js': minor
'@posthog/core': minor
---

Add survey response validation for message length (min and max length). Fixes whitespace-only bypass for required questions. Existing surveys work unchanged but now properly reject blank responses.