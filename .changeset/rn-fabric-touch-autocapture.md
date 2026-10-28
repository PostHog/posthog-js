---
'posthog-react-native': patch
---

fix: capture touch autocapture events on React Native's new architecture (Fabric), where the touched element is only reachable through `target.__internalInstanceHandle`
