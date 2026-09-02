---
'@posthog/core': patch
---

Fix `clampToRange` discarding a valid fallback value of `0`. It used `fallbackValue || max`, so a `0` fallback (a legitimate value) was treated as absent and replaced by `max`; it now uses `??` so `0` is honored.
