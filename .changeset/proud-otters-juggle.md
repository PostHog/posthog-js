---
'@posthog/react-native-plugin': patch
---

Apply the session replay configuration at native SDK setup even when replay starts disabled, so recording turned on later (e.g. `startRecording` or a linked feature flag) uses screenshot mode, the configured masking, and the configured snapshot endpoint instead of wireframe/default settings
