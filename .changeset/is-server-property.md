---
"posthog-node": minor
---

Add a configurable `$is_server` event property (default `true`) so PostHog can identify server-side events. Set `isServer: false` when using the SDK as a client/CLI so the device OS is attributed normally.
