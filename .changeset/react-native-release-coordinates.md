---
'posthog-react-native': patch
---

Key the release an iOS build uploads on the app's Info.plist rather than on Xcode's `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`. The SDK reports `$app_version` and `$app_build` from Info.plist, and Expo writes literal versions there while leaving the build settings at the Xcode template default of `1.0`. A build whose app reported `1.0.0` therefore created its release as `1.0`, so the release did not describe the app that shipped. Releases created by an Expo build now carry the app's real version, which means a project on the default release mode will start creating release rows under that version instead. A project whose Info.plist references the build settings, as a bare React Native app does, is unaffected.
