---
'posthog-js': patch
'posthog-react-native': patch
'@posthog/core': patch
---

Keep backing off a failing log flush while new records arrive, instead of the next record resetting the retry to the flush interval.
