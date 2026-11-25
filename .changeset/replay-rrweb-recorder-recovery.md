---
'posthog-js': patch
---

Session replay restarts its recorder when it stops taking full snapshots, and no longer starts a second recorder when it restarts during its own start.
