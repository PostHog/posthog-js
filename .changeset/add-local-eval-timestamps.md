---
"posthog-node": minor
---

Add timestamp tracking for local feature flag evaluation. Locally evaluated flags now include `$feature_flag_definitions_loaded_at` (when definitions were loaded) and `$feature_flag_evaluated_at` (when the flag was evaluated) in `$feature_flag_called` events, providing equivalent timestamp functionality to remote evaluation.