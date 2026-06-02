---
'posthog-js': minor
'@posthog/types': minor
---

feat(surveys): extend `split_storage` to also move the survey config (`$surveys`) out of the main persistence blob into its own `<name>__surveys` localStorage entry, on top of the feature-flag split. Surveys now stamp a `$surveys_loaded_at` freshness timestamp on every `/surveys` load — the survey analogue of `$feature_flag_evaluated_at` — so a stale `__surveys` entry can no longer win over a fresher survey payload written back into the main blob by a gate-off / older-SDK tab. With no timestamp on either side (migration leftover) the group entry still wins, so the migration path is unchanged. Same backend and `reset()` / opt-out semantics as the flag split.
