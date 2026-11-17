---
'posthog-react-native': minor
'@posthog/react-native-plugin': minor
---

Add `sessionReplayConfig.iOSCaptureMethod` (`'standard'`, `'background'` or experimental `'gpu'`) to choose how iOS captures replay screenshots, and deprecate `screenshotModeBackgroundCapture` in favor of `iOSCaptureMethod: 'background'`
