---
'posthog-node': minor
---

Request `/flags/?v=4` instead of `/flags/?v=2` and read its typed flag records. For a well-formed response, flag getters and `$feature_flag_called` events return the same values as before. A PostHog server that does not serve `v=4` answers as it does for `v=2`, and that response is read as before.

A flag record with a field of the wrong JSON type, such as a string `metadata.version`, now reads as disabled: flag getters return `false` and it has no payload. Other flags in the same response are not affected. This applies to both response versions, so tests that mock `/flags` may need to match the new URL and send correctly typed fields.
