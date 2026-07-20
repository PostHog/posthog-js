---
'@posthog/core': minor
'posthog-js': minor
'posthog-node': minor
'posthog-react-native': minor
---

send minimal `$feature_flag_called` events when the server enables it

When the v2 `/flags` response carries `minimalFlagCalledEvents: true` (or, for posthog-node local evaluation, the flag-definitions payload carries `minimal_flag_called_events: true`) and the evaluated flag is not linked to an experiment (`$feature_flag_has_experiment === false`), `$feature_flag_called` events are rebuilt from a strict allowlist of flag-evaluation, processing-control, and SDK-identity properties. Super properties, `$set`/`$set_once`, the `$feature/<key>` enumeration, `$active_feature_flags`, and the context envelope are stripped. Any missing signal (no gate on the response, bootstrapped or locally injected flags, `has_experiment` unknown) falls back to the full event, and experiment-linked flags always send the full envelope. The gate is stored alongside the cached flags (posthog-js persistence, posthog-node poller state) and is server-controlled, with no SDK-side configuration. `before_send` runs after the filter and may re-add stripped properties.
