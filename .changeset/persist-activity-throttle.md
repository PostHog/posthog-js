---
'posthog-js': patch
---

fix(persistence): throttle session-activity timestamp writes to a 5s granularity. The in-memory value still moves at full resolution; only writes to localStorage/cookie are coalesced. Activity-timestamp-only updates within the granularity window are skipped, dropping localStorage write pressure and cross-tab `storage` event broadcasts on pages that capture many events per second. The pending in-memory value is flushed on `destroy` and `beforeunload` so a tab close inside the window does not leave the persisted value up to 5s stale for sibling tabs. The flush re-reads storage first and bails out if a sibling tab has rotated the session, so the flush cannot clobber the new session with the old id/start.
