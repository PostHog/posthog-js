---
'@posthog/core': patch
'posthog-node': patch
---

Send $device_id as a top-level field in /flags requests so the feature flags service can use it for device-based bucketing during remote evaluation
