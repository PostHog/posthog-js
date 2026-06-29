---
'@posthog/react-native-plugin': patch
---

Forward `requestHeaders` from `sdkOptions` to the native `PostHogConfig` so custom headers (e.g. `Authorization`) are applied to session replay and native error/crash uploads. Requires posthog-ios / posthog-android versions that expose the `requestHeaders` config option.
