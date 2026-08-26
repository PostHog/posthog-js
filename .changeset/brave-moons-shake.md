---
'posthog-react-native': minor
---

Autocapture touches and clicks on React Native Web (including expo-router on web). Touch events there carry no `_targetInst` and every touch was silently dropped, so the element chain is now resolved by walking up from `e.target` to the nearest node carrying a React fiber. `captureTouches` also registers a capture-phase `click` listener on the document on web, emitted with `$event_type: 'click'`, since browsers fire `touchend` only for touch input (react-native-web's `Pressable` stops propagation, and `Modal` renders outside the provider's subtree). Autocapture no longer lets an exception escape into the host app's event dispatch.
