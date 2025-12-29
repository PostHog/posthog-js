---
'posthog-react-native': minor
'posthog-js': minor
'@posthog/core': minor
---

Add survey response validation with configurable rules (minLength, maxLength, email). Fixes whitespace-only bypass for required questions. Existing surveys work unchanged but now properly reject blank responses.