---
'posthog-js': patch
---

Stop sending the `ip` query parameter on feature flag requests. The flags endpoint ignores it, and some ad blockers match `/flags…ip=` to block flag evaluation on any domain. Dropping it from flag requests avoids the block with no functional change. Event and session recording requests are unchanged.
