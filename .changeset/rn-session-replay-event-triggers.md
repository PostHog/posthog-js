---
'posthog-react-native': minor
'@posthog/core': patch
---

Support session replay event triggers in React Native. Recording stays paused until the client captures an event whose name matches a server-configured `sessionRecording.eventTriggers` entry, then records for the rest of that session; it re-arms on session rotation and AND-combines with the linked-flag gate. Requires `@posthog/react-native-plugin` >= 2.2.0 (which pins the native SDKs that defer event-trigger gating to the JS layer).
