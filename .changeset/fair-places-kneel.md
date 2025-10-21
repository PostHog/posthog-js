---
'posthog-node': patch
---

Fix crash caused by calling `getFeatureFlagPayloads` for a flag that depends on a static cohort
