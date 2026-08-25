---
'posthog-react-native': patch
---

Fix touch autocapture on React Native Web (including expo-router on web), where the touch event carries no `_targetInst` and every touch was silently dropped. The element chain is now resolved by falling back to the React fiber on `e.target`.
