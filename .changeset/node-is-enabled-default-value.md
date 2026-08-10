---
"posthog-node": minor
---

`FeatureFlagEvaluations.isEnabled()` now accepts an optional `defaultValue` parameter, returned whenever the flag has no value (missing key, not loaded, or a failed request). A flag with a present value — including `false` and variant strings — always wins over `defaultValue`. Purely additive; omitting the parameter preserves the existing `false`-on-miss behavior.
