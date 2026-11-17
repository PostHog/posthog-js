---
'@posthog/react-native-plugin': patch
---

Require posthog-ios 3.98.0 to pick up the iOS session replay fixes since 3.92.7: skip a screenshot when `drawHierarchy` fails instead of uploading a blank frame, keep masks aligned with `screenshotModeBackgroundCapture` during scroll and animation, schedule capture without swizzling `UIView` layout, and fix replay crashes with custom `CALayer` subclasses and the iPad print panel.
