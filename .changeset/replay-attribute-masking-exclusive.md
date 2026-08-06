---
'posthog-js': patch
'@posthog/types': patch
---

Make the session replay attribute masking options mutually exclusive: when both `maskAllElementAttributes` and `maskAttributeFn` are set, the coarse option wins and the callback is ignored (with a console warning), so a callback can no longer accidentally unmask what `maskAllElementAttributes` hides.
