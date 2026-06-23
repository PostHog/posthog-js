---
'posthog-js': patch
---

Logs: console-log capture no longer crashes during initialization when the session has no timestamps yet. `initializeLogs` called `.toString()` on `sessionStartTimestamp`/`lastActivityTimestamp` without a null guard, so when those were `null` (e.g. right after a session reset) it threw `TypeError: Cannot read properties of null (reading 'toString')` and silently aborted console-log capture for that session. Both reads are now null-guarded and the attributes are only added when present.
