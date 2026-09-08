---
'posthog-js': patch
'@posthog/types': patch
---

Keep session recording snapshots from different session or window ids in separate uploads, so a rotation cannot make the player report a late initial snapshot.
