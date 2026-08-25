---
'posthog-react-native': minor
---

Autocapture clicks on React Native Web. Browsers only fire `touchend` for touch input, so mouse and trackpad users were never captured. `captureTouches` now also registers a capture-phase `click` listener on the document on web (react-native-web's `Pressable` stops propagation, and `Modal` renders outside the provider's subtree), emitting these with `$event_type: 'click'`.
