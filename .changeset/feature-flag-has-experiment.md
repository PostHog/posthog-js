---
'@posthog/core': minor
'@posthog/types': minor
'posthog-js': minor
'posthog-node': minor
'posthog-react-native': minor
---

add `$feature_flag_has_experiment` to `$feature_flag_called` events

Every `$feature_flag_called` event now carries a `$feature_flag_has_experiment` boolean sourced from the server's `has_experiment` flag metadata (the `/flags?v=2` response for remote evaluation, the `/api/feature_flag/local_evaluation` definitions for posthog-node local evaluation). The property defaults to `false` when the server does not report the field.
