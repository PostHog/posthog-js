---
'@posthog/core': patch
'posthog-react-native': patch
---

A feature flag read made before async storage has loaded no longer sends a `$feature_flag_called` event with an empty response; the read is reported with the stored value once storage loads.
