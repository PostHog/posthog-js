---
'@posthog/react-native-plugin': major
---

- **Breaking:** record iOS session replay with the standard capture method when `iOSCaptureMethod` is `'background'` or `screenshotModeBackgroundCapture` is `true`, since posthog-ios 4.0 removed background capture. The plugin logs a message when it falls back
