---
'posthog-js': minor
'@posthog/types': minor
---

feat(persistence): add `persistence_save_debounce_ms` config option to coalesce rapid storage saves into a single write. Setting a positive value debounces writes to localStorage/cookie by that window; the in-memory `props` object still updates synchronously so within-tab reads see the latest values immediately, and pending writes flush on `beforeunload` and `pagehide` so no state is lost on tab close. Cross-tab `storage` events are reduced proportionally to the debounce window. Defaults to `0` (no debouncing) for backwards compatibility. On pages that capture many events per second, `250` is a reasonable starting point. The new `2026-05-30` config default opts into `persistence_save_debounce_ms: 250` automatically.
