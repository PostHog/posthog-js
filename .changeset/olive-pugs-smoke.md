---
'posthog-react-native': minor
---

Autocapture clicks on React Native Web. Browsers only fire `touchend` for touch input, so mouse and trackpad users were never captured. The provider now listens for `click` on its host node in the capture phase (react-native-web's `Pressable` stops propagation, so a bubble-phase handler never sees button presses) and emits these with `$event_type: 'click'`.
