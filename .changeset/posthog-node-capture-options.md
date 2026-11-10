---
'posthog-node': major
---

Every capture call takes a per-event `options` map that is sent to capture unchanged (the SDK no longer converts option values). Legacy option properties still work, but an option overrides its legacy property. Use options.
A `$session_id` or `$window_id` that is not a string is dropped with a warning.
Capture drops an event whose option value it cannot read, such as `cookieless_mode: [1, 2, 3]`, and the SDK reports it through `'error'` with `details: 'invalid_options'`.
