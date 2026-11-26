---
'@posthog/core': patch
'@posthog/browser-common': patch
'posthog-js': patch
---

Stop regex filters with nested repetition, such as `(a+)+`, from stalling event capture. These patterns now never match and log a warning.
