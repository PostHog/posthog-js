---
"@posthog/core": patch
"posthog-react-native": patch
"posthog-js-lite": patch
---

fix: feature-flag properties (`$feature/*` and `$active_feature_flags`) passed explicitly to `capture()` now take precedence over the SDK's cached flag values, matching posthog-js (web) and posthog-android
