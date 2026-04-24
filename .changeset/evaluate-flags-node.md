---
'posthog-node': minor
---

Add `evaluateFlags()` and the `flags` option on `capture()` so a single `/flags` call can power both flag branching and event enrichment per request. Prefer this over repeated `isFeatureEnabled()` calls and `capture({ sendFeatureFlags: true })`, which remain supported but now carry a deprecation note.
