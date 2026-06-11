---
'posthog-js': patch
---

fix(persistence): stop per-request metadata rewriting the split-storage entries on every load

`$feature_flag_evaluated_at`, `$feature_flag_request_id`, and `$surveys_loaded_at` change on every `/flags` (or `/surveys`) load even when the flag and survey content is unchanged. With `split_storage` enabled that made the multi-hundred-KB `__flags` / `__surveys` localStorage entries dirty on every SPA navigation, re-broadcasting the full payload to every open same-origin tab via cross-tab `storage` events — the exact pressure the split exists to remove. These keys are now marked volatile: a value-only change neither dirties the group nor alters its fingerprint, so the write is skipped and the freshest value rides along on the next real content write. Adding or deleting a volatile key still writes through (presence is fingerprinted, the moving value is not), and the in-memory value is always current — only the on-disk copy may lag until the next content change.
