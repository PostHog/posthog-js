---
'posthog-react-native': patch
---

Use the iOS version reported by Info.plist when uploading Hermes source maps, including custom Xcode build settings. Matching native dSYM attribution requires posthog-ios 3.69.10 or later (PostHog/posthog-ios#776).
