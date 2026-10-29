---
'@posthog/react-native-plugin': patch
---

Require posthog-ios 3.92.7 so session replay screenshots without masks upload at the same size as masked ones. Before, they were encoded at native scale, which could leave replay minutes behind.
