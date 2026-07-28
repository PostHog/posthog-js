---
'posthog-js': patch
'@posthog/types': patch
---

Stop bootstrapping from downgrading an already-identified person to anonymous. Previously the guard against silently switching identities only applied when `bootstrap.isIdentifiedID` was `true`, so bootstrapping a distinct ID without it overwrote the stored `distinct_id` and reset the user state to anonymous. The next `identify()` then sent an already-identified ID as `$anon_distinct_id`, a merge the server refuses. The guard now applies whenever persistence already holds an identified person, and `identify()` warns when it is asked to switch away from one.
