---
"posthog-node": patch
---

Reject semver values with leading zeros in local flag evaluation. Per semver 2.0.0 §2, numeric identifiers must not include leading zeros — values like `1.07.3` are not valid semver and should not match targeting conditions. Both override values and flag values are now validated; invalid inputs surface as `InconclusiveMatchError` so the condition does not match.
