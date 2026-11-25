---
'posthog-js': minor
---

Request `/flags/?v=4` instead of `/flags/?v=2` and read its typed flag records. For a well-formed response, flag getters, payloads, `onFeatureFlags` callbacks and `$feature_flag_called` events return and send the same values as before, and older posthog-js versions can still read the stored flags. A PostHog server that does not serve `v=4` answers as it does for `v=2`, and that response is read as before.

A `v=4` flag record with a field of the wrong JSON type, such as a string `metadata.version`, reads as a disabled flag without a payload. Other flags in the same response are not affected. Tests that mock `/flags` may need to match the new URL.
