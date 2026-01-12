---
'posthog-node': minor
---

Add warning when experience continuity flags are detected during local evaluation, and new `strictLocalEvaluation` option.

**Warning:** When using local evaluation with flags that have experience continuity enabled, a warning is now emitted explaining that these flags will cause server requests on every evaluation, negating local evaluation cost savings.

**New option:** `strictLocalEvaluation: true` can be set at client init to prevent all server fallback for flag evaluations. Flags that cannot be evaluated locally will return `undefined` instead of making a server request. This is useful in high-volume environments where you want to guarantee no unexpected server costs.