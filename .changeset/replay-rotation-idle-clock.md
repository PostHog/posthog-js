---
'posthog-js': patch
---

fix(replay): reset the idle clock on a session-id rotation so the new session's first snapshot is not dropped as idle and its recording does not start hours early
