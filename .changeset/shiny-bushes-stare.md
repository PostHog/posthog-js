---
'posthog-js': patch
---

`isFeatureEnabled` now returns `undefined` (instead of `false`) for missing or disabled feature flags, aligning with the documentation. Previously, `undefined` was returned only before flags had loaded, and missing/disabled flags returned `false`. This change clarifies the difference between flags that exist but don't match (`false`) and flags that don’t exist or are disabled (`undefined`).
