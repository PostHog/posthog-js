---
'posthog-node': minor
---

Support the `starts_with`, `not_starts_with`, `ends_with`, and `not_ends_with` property filter operators in feature flag local evaluation. Matching is case-insensitive and mirrors `icontains`, so flags using these operators no longer fall back to remote evaluation.
