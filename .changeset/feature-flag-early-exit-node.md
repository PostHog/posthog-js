---
'posthog-node': minor
---

feat(feature-flags): support the `early_exit` condition option in local evaluation. When a flag enables early exit, evaluation now stops and returns `false` as soon as a condition group's property filters match but the rollout percentage excludes the user, instead of falling through to later groups — matching the server-side evaluation behavior.
