---
'@posthog/core': patch
---

fix(core): summarize the keys of a non-`Error` exception in one pass, so capturing a very wide thrown object no longer takes quadratic time.
