---
'posthog-js': patch
---

fix(replay): attribute the backdated sessionIdle marker to the session that went idle, so a rotation-born session's recording no longer starts hours before its first snapshot
