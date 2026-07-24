---
'posthog-node': patch
---

fix: `personProperties` and `groupProperties` on the feature flag methods are no longer typed as `Record<string, string>`, so numeric and boolean values type-check without a cast. Local evaluation already handled them — `matchProperty` takes `Record<string, any>` and compares numerically for `gt`/`gte`/`lt`/`lte` — only the public types disagreed. These now use the shared `Properties` type (`personProperties?: Properties`, `groupProperties?: Record<string, Properties>`), matching `setPersonPropertiesForFlags`/`setGroupPropertiesForFlags` so the `any` can be narrowed later. Types only, no runtime change.
