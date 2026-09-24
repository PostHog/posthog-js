---
"@posthog/core": minor
---

Add opt-in heuristic bot detection for #2921. New exports `heuristicBotScore` and `isImpossibleChromeVersion` (both pure functions), plus an optional third argument on `isBlockedUA` for `heuristics: 'off' | 'balanced' | 'strict'`. Default behaviour is unchanged. `DEFAULT_BLOCKED_UA_STRS` is preserved byte-for-byte. Adds session-level memoisation with a length-prefixed cache key so repeat calls in the same session cost O(1). See PR body for the design, evidence and benchmarks.
