---
'posthog-js': patch
---

fix: a remote config response missing the `autocapture_opt_out` field no longer enables autocapture; the SDK keeps the last known server value, the same as when the config fetch fails
