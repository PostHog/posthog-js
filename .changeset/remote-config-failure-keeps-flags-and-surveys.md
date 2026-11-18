---
'@posthog/core': patch
'posthog-react-native': patch
---

When the remote config request fails at startup, feature flags still load and React Native keeps its cached surveys instead of clearing them.
