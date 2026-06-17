---
'posthog-js': patch
---

Fix `updateFlags(flags, payloads, { merge: true })` baking an active feature flag override into the stored flags. The merge now seeds from the raw stored flags rather than the override-applied values, so clearing the override afterwards correctly restores the original flag.
