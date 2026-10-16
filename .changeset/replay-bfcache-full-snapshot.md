---
'posthog-js': patch
---

Take a new full snapshot in session replay when a page comes back from the back/forward cache, so the recording does not keep showing the page the user left. The recorder also adds a `$bfcache_restore` custom event to mark the restore.
