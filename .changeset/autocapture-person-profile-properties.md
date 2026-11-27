---
'@posthog/core': patch
---

`$autocapture` events now carry `$process_person_profile` and `$is_identified`, so the `personProfiles` setting applies to them like other captured events.
