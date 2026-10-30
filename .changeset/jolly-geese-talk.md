---
'@posthog/react-native-plugin': minor
---

Require posthog-android 3.74.2. Android apps that do not set `screenshotScale` now capture session replay screenshots at one pixel per dp, so uploads are smaller. Set `screenshotScale: 1` to keep native resolution. Session replay also records `FLAG_SECURE` windows fully masked and drops frames where an animating view would expose masked content.
