---
'posthog-node': major
---

Every capture call takes a per-event `options` map that is sent to capture unchanged (the SDK no longer converts option values); legacy `$` option properties such as `$process_person_profile` still fill unset options and are removed from `properties`.
A `$session_id` or `$window_id` that is not a string is dropped with a warning.
