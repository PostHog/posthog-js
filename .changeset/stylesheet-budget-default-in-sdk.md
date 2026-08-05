---
'posthog-js': patch
'@posthog/types': patch
---

Move the default stylesheet inlining budget (10,000 rules) from the rrweb recorder into the posthog-js session recording options. The recorder chunk loads from an unversioned path, so cached or npm-pinned array.js bundles were getting the new budget with no way to change it: their config allowlist predates `inlineStylesheetBudgetRules`, so a user's override (including `0` to disable) was silently dropped while the behaviour change was live. The budget now only turns on when the posthog-js version that carries the option ships alongside the recorder, and direct `rrweb.record()` consumers get the previous unbounded inlining unless they opt in.
