---
'posthog-js': minor
'@posthog/types': minor
---

feat(persistence): add `split_storage` config option to store the feature-flag config cluster in its own localStorage entry (`<name>__flags`) instead of the single main persistence blob. This payload is large and changes rarely, so keeping it out of the main blob stops it riding on every high-frequency main-blob write and broadcasting on cross-tab `storage` events. Reads are unchanged: on load the entry is merged back into the in-memory props, and the old main-blob location is read once and migrated forward so upgrades never miss a cached flag. The split only applies when persistence resolves to `localStorage` / `localStorage+cookie` (it is pointless for `memory` / `sessionStorage` and impossible for `cookie`), and `reset()` / opt-out wipe every entry. Defaults to `false` for backwards compatibility; the new `2026-05-30` config default opts in automatically.
