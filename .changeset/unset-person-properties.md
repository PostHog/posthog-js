---
'posthog-js': minor
'@posthog/core': minor
'@posthog/types': minor
'posthog-react-native': minor
---

Add `unsetPersonProperties()` to remove person properties, the counterpart to `setPersonProperties()`. Previously the only way to unset a person property was to hand-pass a `$unset` array inside a `capture()` call.
