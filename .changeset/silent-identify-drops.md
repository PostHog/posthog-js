---
'posthog-js': patch
'posthog-node': patch
---

Make silently dropped person properties visible.

`posthog-js` now reports a call ignored because `person_profiles` is `"never"` as a client ingestion warning, once per call site, instead of only writing to the browser console. It also stops caching a `$set` or `$identify` that `capture` never sent, so a retry with the same properties is no longer treated as a duplicate.

`posthog-node` now warns when `identify` receives both `$set` and sibling top-level properties, which drops those siblings.
