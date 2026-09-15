---
'@posthog/core': patch
'posthog-node': patch
'@posthog/convex': patch
---

Respect the definitions response's `property_matching_version` during local feature flag evaluation. Version 2 uses explicit boolean/string equality and per-member array matching, while missing or other versions retain service legacy matching (including empty-array truthiness). Preserve the version in Node definition caches and Convex persisted definitions, and propagate it through person, group, cohort and dependency evaluation without mixing snapshots during reloads. Existing numeric ambiguity fallback and SemVer parsing policies are unchanged.
