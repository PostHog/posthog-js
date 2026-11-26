---
'posthog-react-native': minor
'@posthog/core': patch
---

Support session replay v2 trigger groups (`sessionRecording.version: 2`) with per-group event, screen and flag conditions and per-group sampling. On a first launch with nothing cached, replay now waits for the remote config before it starts, for v1 and v2 configs alike, and so does a `startSessionRecording()` call.
