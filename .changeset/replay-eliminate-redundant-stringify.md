---
"posthog-js": patch
---

Reduce session replay memory pressure by tracking per-event sizes in SnapshotBuffer, eliminating redundant JSON.stringify calls during buffer operations. Also bumps @posthog/rrweb to 0.0.46 which uses FNV-1a hash-based canvas frame deduplication instead of storing full base64 strings.
