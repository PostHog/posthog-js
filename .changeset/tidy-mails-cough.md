---
'posthog-js': patch
'@posthog/types': patch
---

Adds a fresh option to getFeatureFlag(), getFeatureFlagResult(), and isFeatureEnabled() that only returns values loaded from the server, not cached localStorage values.
