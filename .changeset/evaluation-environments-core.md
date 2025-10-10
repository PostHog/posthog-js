---
'@posthog/core': minor
---

feat: Add evaluation environments support for feature flags

This PR adds base support for evaluation environments in the core library, allowing SDKs that extend the core to specify which environment tags their SDK instance should use when evaluating feature flags.

The core library now handles sending the `evaluation_environments` parameter to the feature flags API when configured.
