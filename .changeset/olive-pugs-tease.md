---
'posthog-js': patch
'@posthog/react': patch
---

fix(feature-flags): validate bootstrapped feature flag values. A `/flags?v=2` detail object (`{ key, enabled, variant }`) is now flattened to `variant ?? enabled` with a warning, instead of being stored and read back as a flag value.
