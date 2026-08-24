---
'@posthog/react-native-plugin': patch
---

Bump `com.posthog:posthog-android` to `3.60.7`. The pinned `3.58.0` stopped a manually started session replay (`sessionReplay.enabled: false` plus `startRecording()`) as soon as it started, and reported `isSessionReplayActive()` as `true` while capturing nothing. 3.60.7 also keeps that recording alive after the session is cleared on a long background.
