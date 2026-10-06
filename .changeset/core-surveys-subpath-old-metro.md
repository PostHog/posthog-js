---
'@posthog/core': patch
'posthog-react-native': patch
---

Fix `Unable to resolve module @posthog/core/surveys` when bundling posthog-react-native on React Native 0.71–0.78 without Metro package exports. posthog-react-native 4.47.0 and later also pick up the fix by updating `@posthog/core`.
