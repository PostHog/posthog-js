---
'posthog-js': patch
---

fix(replay): retry the full-snapshot heal when a rotated session ships incrementals first, so a single failed heal no longer leaves the rest of the recording unplayable
