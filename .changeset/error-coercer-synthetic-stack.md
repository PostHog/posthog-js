---
'@posthog/core': patch
'posthog-js': patch
---

Fall back to the synthetic exception stack when a captured `Error` has no stack, so frameless failures (such as a Firefox network `fetch` `TypeError`) keep their call-site frames and group per call site instead of merging into one issue.
