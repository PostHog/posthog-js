---
'posthog-react-native': patch
---

Fix session replay attaching to another client's session when an app creates more than one `PostHog` client; a client for a different project no longer sends `identify()`, opt-out, push or replay calls to the native SDK, which stays with the first client's project.
