---
'@posthog/react-native-plugin': patch
---

Require posthog-android 3.73.2, which records session replay frames of `FLAG_SECURE` windows fully masked and drops frames where an animating view would expose masked content.
