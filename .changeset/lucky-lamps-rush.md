---
'posthog-react-native': patch
---

Fix touch autocapture on React Native Web (including expo-router on web), where the touch event carries no `_targetInst` and every touch was silently dropped. The element chain is now resolved by walking up from `e.target` to the nearest node carrying a React fiber. Autocapture also no longer lets an exception escape into the host app's event dispatch.
