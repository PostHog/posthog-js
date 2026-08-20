---
'posthog-react-native': patch
'@posthog/react-native-plugin': patch
---

fix(react-native): warn when a local `sessionReplayConfig.sampleRate` overrides the project setting, warn when replay starts with no cached remote config, and log the native plugin version next to the replay config. Export the native plugin package metadata so the SDK can resolve that version through a supported entrypoint.
