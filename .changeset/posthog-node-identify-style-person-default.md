---
'posthog-node': major
---

`$identify`, `$create_alias`, `$merge_dangerously`, `$groupidentify`, `$set` and `$set_once` events default to `process_person_profile: true` unless the call sets it, so a `false` from context, `register()` or `registerOptions()` no longer turns person processing off for them.
