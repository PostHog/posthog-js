---
'@posthog/react-native-plugin': minor
---

Require posthog-android 3.74.0. Android apps that do not set `screenshotScale` now capture session replay screenshots at one pixel per dp, so uploads are smaller. Set `screenshotScale: 1` to keep native resolution.
