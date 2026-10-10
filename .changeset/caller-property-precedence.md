---
'@posthog/core': minor
'posthog-react-native': minor
'posthog-js-lite': minor
---

Change properties passed to `capture()` and the other event methods to override SDK context properties such as `$app_version`, `$os_name` and `$lib`, matching posthog-js and posthog-android
