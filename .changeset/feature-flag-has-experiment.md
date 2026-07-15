---
'@posthog/core': minor
'@posthog/types': minor
'posthog-js': minor
'posthog-node': minor
'posthog-react-native': minor
---

add `$feature_flag_has_experiment` to `$feature_flag_called` events

`$feature_flag_called` events now carry a `$feature_flag_has_experiment` boolean sourced from the server's `has_experiment` flag metadata (the `/flags?v=2` response for remote evaluation, the `/api/feature_flag/local_evaluation` definitions for posthog-node local evaluation). The property is only sent when the server explicitly reports `has_experiment`; it is omitted entirely when the value is unknown (older servers, missing metadata, bootstrapped or locally injected flags).
