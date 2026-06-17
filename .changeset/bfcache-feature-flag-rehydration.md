---
'posthog-js': patch
---

Reload feature flags when a page is restored from the browser's back-forward cache (bfcache).

On a bfcache restore the SDK is not re-initialized — the JS heap, including cached feature flags, is restored as-is and no `/flags` request is made. When `feature_flag_cache_ttl_ms` is configured, those restored flags can be past their TTL, so `getFeatureFlag()` returns `undefined` (read as `false` by app guards) until something else triggers a reload, silently disabling gated features. Some Chromium-based browsers (e.g. Arc) restore from bfcache aggressively, even on a plain refresh. We now listen for `pageshow` and call `reloadFeatureFlags()` when `event.persisted` is true, so a restored page self-heals within one network round-trip.
