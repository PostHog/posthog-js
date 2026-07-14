---
'@posthog/react-native-plugin': patch
---

Require posthog-ios 3.64.7 or later, so release builds can skip conflicting dSYM uploads (the Expo plugin's `skipOnConflict` option) instead of failing when a dSYM with the same UUID but different content already exists in PostHog.
