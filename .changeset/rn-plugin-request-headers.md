---
'@posthog/react-native-plugin': patch
---

Forward `requestHeaders` from `sdkOptions` to the native `PostHogConfig` so custom headers (e.g. `Authorization`) are applied to session replay and native error/crash uploads. Bumps the native dependencies to posthog-ios 3.63.0 / posthog-android 3.52.0, which add the `requestHeaders` config option.
