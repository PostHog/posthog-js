---
'posthog-react-native': patch
'@posthog/react-native-plugin': patch
---

Report React render-error crashes on iOS through native crash capture instead of dropping them (requires updating both `posthog-react-native` and `@posthog/react-native-plugin`).
