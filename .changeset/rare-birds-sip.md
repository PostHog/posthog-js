---
'@posthog/core': patch
'@posthog/browser-common': patch
'posthog-js': patch
---

Stop property, survey, action, and web experiment regex filters with nested repetition, such as `(a+)+`, from stalling event capture. These patterns are now treated like invalid patterns and log a warning.
