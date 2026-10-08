---
'posthog-node': patch
---

Evict only the least recently used distinct ids from the `$feature_flag_called` dedupe cache instead of clearing it entirely. `distinctIdHasSentFlagCalls` now returns a snapshot, so writing or deleting individual keys on it no longer changes deduplication.
