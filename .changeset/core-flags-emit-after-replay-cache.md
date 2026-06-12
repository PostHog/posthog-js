---
'@posthog/core': patch
---

fix: persist the session replay config from a `/flags` response before emitting the `featureflags` event, so listeners (e.g. React Native session replay linked-flag re-evaluation) read a recording config consistent with the new flag values. This only reorders two adjacent synchronous writes in the stateful core client (used by `posthog-react-native` and `@posthog/web`); the event payload is unchanged, and `posthog-node` and the browser `posthog-js` package do not use this code path.
