---
'posthog-js': patch
---

fix: on page unload, split a session replay batch that is over the beacon limit by its rrweb entries so the entries that fit still send; a single entry over the limit can still be lost
