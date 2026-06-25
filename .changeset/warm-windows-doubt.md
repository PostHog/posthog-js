---
'posthog-node': patch
---

Fix local evaluation ignoring the `in`/`not_in` operator on cohort-based flag conditions. "Not in
cohort" was evaluated as "in cohort", inverting cohort-exclusion flags. Now applies the operator to
the cohort membership result.
