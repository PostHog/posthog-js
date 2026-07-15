---
'@posthog/react-native-plugin': patch
---

Bump `com.posthog:posthog-android` to `3.54.0` to pick up the session replay ANR fix from 3.53.7: clearing the replay buffer on session rotation (e.g. `identify()` at login) no longer blocks the main thread waiting on the replay executor.
