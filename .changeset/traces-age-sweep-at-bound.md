---
'@posthog/core': patch
'posthog-node': patch
'@posthog/types': patch
---

Stop dropping long spans that end: `maxSpanAgeMs` now evicts spans only once `maxLiveSpans` is reached, so a span that runs past the age limit and then ends is exported, and its children are no longer orphaned.
