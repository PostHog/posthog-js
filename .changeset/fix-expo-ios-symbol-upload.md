---
'posthog-react-native': patch
---

Use the iOS version reported by Info.plist when uploading Hermes source maps, including custom Xcode build settings. Matching native dSYM attribution requires @posthog/react-native-plugin 2.4.2 or later (PostHog/posthog-ios#776).
