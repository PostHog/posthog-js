# @posthog/types

## 1.387.0

### Minor Changes

- [#3709](https://github.com/PostHog/posthog-js/pull/3709) [`c6c163a`](https://github.com/PostHog/posthog-js/commit/c6c163aefb093d5609977ae243b056f96a2d3b4e) Thanks [@posthog](https://github.com/apps/posthog)! - Add `unsetPersonProperties()` to remove person properties, the counterpart to `setPersonProperties()`. Previously the only way to unset a person property was to hand-pass a `$unset` array inside a `capture()` call.
  (2026-06-16)

### Patch Changes

- [#3860](https://github.com/PostHog/posthog-js/pull/3860) [`c9c7df1`](https://github.com/PostHog/posthog-js/commit/c9c7df1e7f3ae6152aa80f98b49be206fdff1b23) Thanks [@marandaneto](https://github.com/marandaneto)! - Add `$unset` to capture options and pass it through in browser capture payloads.
  (2026-06-16)

## 1.386.4

### Patch Changes

- [#3837](https://github.com/PostHog/posthog-js/pull/3837) [`29bf8e3`](https://github.com/PostHog/posthog-js/commit/29bf8e386a4050531e9cfd906c33b75945fcb6ad) Thanks [@marandaneto](https://github.com/marandaneto)! - Add missing bugs metadata to package manifests.
  (2026-06-15)

## 1.386.3

### Patch Changes

- [#3690](https://github.com/PostHog/posthog-js/pull/3690) [`dbf2377`](https://github.com/PostHog/posthog-js/commit/dbf23777e1c14a811c67697684d56145518ebe16) Thanks [@pauldambra](https://github.com/pauldambra)! - fix(sessionid): keep the session id stable across tabs

    A session now rotates only when every tab has been idle past the timeout, rather than whenever a single background tab decides it is idle. On the active event path an idle tab re-reads the session id from storage before rotating: if a sibling tab kept the session alive it does not rotate, and if a sibling already rotated it adopts that id instead of minting a new one. This removes spurious cross-tab session fragmentation (inflated session counts, truncated session durations, split replays). When a sibling session is adopted, `onSessionId` handlers fire with `changeReason.crossTabAdoption: true` so session recording, pageview state, and session-scoped properties follow the new session. When `persistence_save_debounce_ms > 0` (the `2026-05-30` default) the refresh reads only the session-id key so it cannot clobber a sibling's write.

    Note: projects with significant multi-tab usage will see fewer but longer sessions after upgrading — this is a correction of previously over-counted sessions, not a traffic change. (2026-06-11)

## 1.386.2

## 1.386.1

## 1.386.0

## 1.385.0

### Minor Changes

- [#3777](https://github.com/PostHog/posthog-js/pull/3777) [`f601c49`](https://github.com/PostHog/posthog-js/commit/f601c496338ed0be8853f94160ee3edca542ac7d) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Promote external dependency script versioning to supported `strict_script_versioning` and `asset_host` config options.
  (2026-06-10)

### Patch Changes

- [#3753](https://github.com/PostHog/posthog-js/pull/3753) [`c11794d`](https://github.com/PostHog/posthog-js/commit/c11794dd5fbb73d99bb88600ae487f8f08f625be) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Reload feature flags by default when resetting person properties for flags.
  (2026-06-10)

## 1.384.3

### Patch Changes

- [#3791](https://github.com/PostHog/posthog-js/pull/3791) [`2d21ada`](https://github.com/PostHog/posthog-js/commit/2d21ada24479c0d4f561dd3b6f5922ce3f8e4afd) Thanks [@marandaneto](https://github.com/marandaneto)! - Deprecate `__preview_disable_beacon` in favor of `disable_beacon` and mark `__preview_disable_xhr_credentials` as a no-op.
  (2026-06-10)

## 1.384.2

### Patch Changes

- [#3789](https://github.com/PostHog/posthog-js/pull/3789) [`d9462b3`](https://github.com/PostHog/posthog-js/commit/d9462b3567a0b7c9b755552c303814b6fcbe3a97) Thanks [@marandaneto](https://github.com/marandaneto)! - Deprecate `__preview_eager_load_replay` as a no-op now that session replay lazy loading is the default.
  (2026-06-10)

## 1.384.1

## 1.384.0

### Minor Changes

- [#3782](https://github.com/PostHog/posthog-js/pull/3782) [`0c2acb9`](https://github.com/PostHog/posthog-js/commit/0c2acb9f30d545bb89d1f950ba8f840c76e47dc2) Thanks [@pauldambra](https://github.com/pauldambra)! - Detect the Google Search App (GSA) as its own `$browser` value (`Google Search App`) via the cross-platform `GSA/` UA marker, instead of reporting the embedded webview as Mobile Safari (iOS) or Chrome (Android). Gated behind the new `detect_google_search_app` config option, which the `2026-05-30` config defaults opt into automatically — left off otherwise to keep existing browser attribution backwards-compatible.

    Note: `$browser_version` for `Google Search App` is not comparable across platforms — iOS yields a version like `284.0` (from `GSA/284.0.564099828`) while Android yields a version like `14.21` (from `GSA/14.21.20.28.arm64`), since Google maintains separate versioning schemes for the two apps. Avoid building cross-platform version dashboards on `$browser_version` for this browser. (2026-06-10)

## 1.383.3

### Patch Changes

- [#3776](https://github.com/PostHog/posthog-js/pull/3776) [`783ba46`](https://github.com/PostHog/posthog-js/commit/783ba461b0916c3f379c227d08470687d38d0768) Thanks [@marandaneto](https://github.com/marandaneto)! - Deprecate the no-op `__preview_flags_v2` browser SDK config option. The SDK already uses the `/flags/?v=2` endpoint by default.
  (2026-06-09)

## 1.383.2

## 1.383.1

## 1.383.0

### Minor Changes

- [#3771](https://github.com/PostHog/posthog-js/pull/3771) [`227c9b0`](https://github.com/PostHog/posthog-js/commit/227c9b03c19dcb93d9a15abb1ee6b9523d366767) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat(persistence): add `split_storage` config option to store the feature-flag config cluster in its own localStorage entry (`<name>__flags`) instead of the single main persistence blob. This payload is large and changes rarely, so keeping it out of the main blob stops it riding on every high-frequency main-blob write and broadcasting on cross-tab `storage` events. Reads are unchanged: on load the entry is merged back into the in-memory props, and the old main-blob location is read once and migrated forward so upgrades never miss a cached flag. The split only applies when persistence resolves to `localStorage` / `localStorage+cookie` (it is pointless for `memory` / `sessionStorage` and impossible for `cookie`), and `reset()` / opt-out wipe every entry. Defaults to `false` for backwards compatibility; the new `2026-05-30` config default opts in automatically.
  (2026-06-08)

- [#3727](https://github.com/PostHog/posthog-js/pull/3727) [`393f9e2`](https://github.com/PostHog/posthog-js/commit/393f9e2a4697c6ffe52402cad6fb8550b48b5e00) Thanks [@pauldambra](https://github.com/pauldambra)! - feat(surveys): extend `split_storage` to also move the survey config (`$surveys`) out of the main persistence blob into its own `<name>__surveys` localStorage entry, on top of the feature-flag split. Surveys now stamp a `$surveys_loaded_at` freshness timestamp on every `/surveys` load — the survey analogue of `$feature_flag_evaluated_at` — so a stale `__surveys` entry can no longer win over a fresher survey payload written back into the main blob by a gate-off / older-SDK tab. With no timestamp on either side (migration leftover) the group entry still wins, so the migration path is unchanged. Same backend and `reset()` / opt-out semantics as the flag split.
  (2026-06-08)

## 1.382.0

## 1.381.0

### Minor Changes

- [#3719](https://github.com/PostHog/posthog-js/pull/3719) [`a7bd828`](https://github.com/PostHog/posthog-js/commit/a7bd828050d070e1b88eb69c3f9db71c5d08f446) Thanks [@lricoy](https://github.com/lricoy)! - Add `__preview_cookie_wins_on_conflict` opt-in config to prefer cookie values over localStorage when merging persistence state in `localStorage+cookie` mode, fixing cross-subdomain identify and session disconnects.
  (2026-06-05)

## 1.380.1

## 1.380.0

### Minor Changes

- [#3715](https://github.com/PostHog/posthog-js/pull/3715) [`2387084`](https://github.com/PostHog/posthog-js/commit/2387084d4d7e28c606a0b0ab23ac0762dcf904d7) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Promote browser tracing header configuration to the public `tracing_headers` option while keeping `addTracingHeaders` and `__add_tracing_headers` as deprecated aliases.
  (2026-06-04)

## 1.379.3

## 1.379.2

## 1.379.1

## 1.379.0

## 1.378.1

## 1.378.0

### Minor Changes

- [#3688](https://github.com/PostHog/posthog-js/pull/3688) [`8181354`](https://github.com/PostHog/posthog-js/commit/8181354cae602f3f2b5e8c5b5bcd2e090e25edcc) Thanks [@pauldambra](https://github.com/pauldambra)! - feat(persistence): add `persistence_save_debounce_ms` config option to coalesce rapid storage saves into a single write. Setting a positive value debounces writes to localStorage/cookie by that window; the in-memory `props` object still updates synchronously so within-tab reads see the latest values immediately, and pending writes flush on `beforeunload` and `pagehide` so no state is lost on tab close. Cross-tab `storage` events are reduced proportionally to the debounce window. Defaults to `0` (no debouncing) for backwards compatibility. On pages that capture many events per second, `250` is a reasonable starting point. The new `2026-05-30` config default opts into `persistence_save_debounce_ms: 250` automatically.
  (2026-06-01)

## 1.377.0

## 1.376.6

## 1.376.5

## 1.376.4

## 1.376.3

## 1.376.2

## 1.376.1

## 1.376.0

## 1.375.0

### Minor Changes

- [#3641](https://github.com/PostHog/posthog-js/pull/3641) [`2e1d5f4`](https://github.com/PostHog/posthog-js/commit/2e1d5f4081c98a04e6a16f57e42491911453994d) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Add `flag_keys` config to restrict browser feature flag remote evaluation to specific flag keys.
  (2026-05-21)

## 1.374.4

## 1.374.3

### Patch Changes

- [#3607](https://github.com/PostHog/posthog-js/pull/3607) [`557b893`](https://github.com/PostHog/posthog-js/commit/557b8934aa0b990184e0376fb1fc28433ad336c6) Thanks [@eli-r-ph](https://github.com/eli-r-ph)! - Enable $web_vitals reporting when cookieless mode is enabled
  (2026-05-20)

## 1.374.2

## 1.374.1

## 1.374.0

### Minor Changes

- [#3620](https://github.com/PostHog/posthog-js/pull/3620) [`594ea11`](https://github.com/PostHog/posthog-js/commit/594ea1146045d49080f6dfd951b037c13278e975) Thanks [@pauldambra](https://github.com/pauldambra)! - Dead clicks: add a `.ph-no-deadclick` CSS class (and `capture_dead_clicks.css_selector_ignorelist` config option) to exclude specific elements from dead-click detection without affecting autocapture, session replay, or heatmaps. Mirrors the existing `.ph-no-rageclick` pattern.
  (2026-05-18)

## 1.373.5

## 1.373.4

## 1.373.3

## 1.373.2

## 1.373.1

## 1.373.0

### Minor Changes

- [#3547](https://github.com/PostHog/posthog-js/pull/3547) [`4c0c7d9`](https://github.com/PostHog/posthog-js/commit/4c0c7d9f48e6f4f5301f8208285191f62dc8407a) Thanks [@williamchong](https://github.com/williamchong)! - `capture()` now accepts an optional `uuid` on `CaptureOptions`.
  (2026-05-11)

### Patch Changes

- [#3559](https://github.com/PostHog/posthog-js/pull/3559) [`0a835fa`](https://github.com/PostHog/posthog-js/commit/0a835fa1d5db988d508aa023240ab5b4b50f0969) Thanks [@marandaneto](https://github.com/marandaneto)! - Skip remote config background refreshes when no document is available.
  (2026-05-11)

## 1.372.10

## 1.372.9

## 1.372.8

## 1.372.7

## 1.372.6

## 1.372.5

## 1.372.4

## 1.372.3

## 1.372.2

## 1.372.1

## 1.372.0

## 1.371.4

## 1.371.3

## 1.371.2

### Patch Changes

- [#3453](https://github.com/PostHog/posthog-js/pull/3453) [`96f19b7`](https://github.com/PostHog/posthog-js/commit/96f19b79d563937ed8f98e12796eee541a2dae7f) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Lift OTLP log serialization helpers from posthog-js into @posthog/core so the
  upcoming React Native logs feature consumes the same builders. Browser gains
  two fixes as a side effect: NaN and ±Infinity attribute values no longer get
  silently dropped during JSON encoding, and the scope.version OTLP field is
  now populated with the SDK version (changes the server's instrumentation_scope
  column from "posthog-js@" to "posthog-js@<semver>"). (2026-04-23)

## 1.371.1

## 1.371.0

### Minor Changes

- [#3432](https://github.com/PostHog/posthog-js/pull/3432) [`1a8b727`](https://github.com/PostHog/posthog-js/commit/1a8b7277c50a42bbb3f736afd530ff1c3389a7de) Thanks [@richardsolomou](https://github.com/richardsolomou)! - refactor: rename `__add_tracing_headers` to `addTracingHeaders`. The `__` prefix signalled an internal/experimental option, but the config is a public API (documented for linking LLM traces to session replays). `__add_tracing_headers` continues to work as a deprecated alias on the browser SDK.

    Also exposes `patchFetchForTracingHeaders` from `@posthog/core` so non-browser SDKs can reuse the implementation. (2026-04-23)

## 1.370.1

## 1.370.0

### Minor Changes

- [#3389](https://github.com/PostHog/posthog-js/pull/3389) [`922a1c1`](https://github.com/PostHog/posthog-js/commit/922a1c1838a5ed2ad37f59dade5fc3cc81bb4246) Thanks [@hpouillot](https://github.com/hpouillot)! - Add exception steps to error tracking (aka breadcrumbs)
  (2026-04-22)

## 1.369.5

## 1.369.4

## 1.369.3

## 1.369.2

### Patch Changes

- [#3386](https://github.com/PostHog/posthog-js/pull/3386) [`4a65604`](https://github.com/PostHog/posthog-js/commit/4a65604775fe87c47e5fbdb5f03673f2481c26ea) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Add a preview flag for versioned browser lazy bundle asset paths.
  (2026-04-16)

## 1.369.1

## 1.369.0

## 1.368.2

## 1.368.1

## 1.368.0

### Minor Changes

- [#3345](https://github.com/PostHog/posthog-js/pull/3345) [`3fcf5c4`](https://github.com/PostHog/posthog-js/commit/3fcf5c449b3fe10ce187d40ea03425de9f94e85f) Thanks [@jonmcwest](https://github.com/jonmcwest)! - Add posthog.captureLog() API for sending structured log entries to PostHog logs
  (2026-04-13)

## 1.367.0

## 1.366.2

## 1.366.1

## 1.366.0

## 1.365.5

## 1.365.4

## 1.365.3

## 1.365.2

### Patch Changes

- [#3323](https://github.com/PostHog/posthog-js/pull/3323) [`c387f6d`](https://github.com/PostHog/posthog-js/commit/c387f6dc146c9c09640e471e66043ad832b0476e) Thanks [@pauldambra](https://github.com/pauldambra)! - perf(replay): reduce memory and CPU cost of event compression by caching gzipped empty arrays and eliminating redundant JSON.stringify for size estimation
  (2026-04-08)

## 1.365.1

## 1.365.0

## 1.364.7

## 1.364.6

## 1.364.5

## 1.364.4

## 1.364.3

## 1.364.2

## 1.364.1

## 1.364.0

## 1.363.6

## 1.363.5

### Patch Changes

- [#3274](https://github.com/PostHog/posthog-js/pull/3274) [`ba08262`](https://github.com/PostHog/posthog-js/commit/ba08262a0bcf4ae1db3ef3bb841e0ad07002fbea) Thanks [@pauldambra](https://github.com/pauldambra)! - fix: document visibility change shoudln't capture dead click
  (2026-03-25)

## 1.363.4

## 1.363.3

## 1.363.2

## 1.363.1

## 1.363.0

### Patch Changes

- [#3245](https://github.com/PostHog/posthog-js/pull/3245) [`1acd6fd`](https://github.com/PostHog/posthog-js/commit/1acd6fdfaaa46da71ca15bba2916c3bb81c3e7ef) Thanks [@dmarticus](https://github.com/dmarticus)! - handle plain array and object forms in overrideFeatureFlags
  (2026-03-20)

## 1.362.0

## 1.361.1

## 1.361.0

### Minor Changes

- [#3241](https://github.com/PostHog/posthog-js/pull/3241) [`fe1fd7b`](https://github.com/PostHog/posthog-js/commit/fe1fd7b222b2ca51164e01fceca892628efac89c) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: add `advanced_feature_flags_dedup_per_session` config option to scope `$feature_flag_called` deduplication to the current session
  (2026-03-18)

### Patch Changes

- [#3201](https://github.com/PostHog/posthog-js/pull/3201) [`552c018`](https://github.com/PostHog/posthog-js/commit/552c01843b9ae1fbf8fdf1a2e98e0b7fdc37c851) Thanks [@frankh](https://github.com/frankh)! - Add a serviceName config option to logs config
  (2026-03-18)

## 1.360.2

## 1.360.1

## 1.360.0

### Minor Changes

- [#3207](https://github.com/PostHog/posthog-js/pull/3207) [`c5a37cb`](https://github.com/PostHog/posthog-js/commit/c5a37cbc248515ff5333f425ffa270136169d47f) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: Add TreeShakeable<T>
  (2026-03-09)

## 1.359.1

## 1.359.0

## 1.358.1

## 1.358.0

## 1.357.2

## 1.357.1

## 1.357.0

### Minor Changes

- [#3169](https://github.com/PostHog/posthog-js/pull/3169) [`4f885c0`](https://github.com/PostHog/posthog-js/commit/4f885c067f3e46398629f4163a204206e71d4757) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: add local sampleRate config for session recording
  (2026-03-02)

## 1.356.2

## 1.356.1

## 1.356.0

### Minor Changes

- [#3142](https://github.com/PostHog/posthog-js/pull/3142) [`ec54fd8`](https://github.com/PostHog/posthog-js/commit/ec54fd8fcfda496879e456361fb97de504063393) Thanks [@dmarticus](https://github.com/dmarticus)! - Add feature_flag_cache_ttl_ms config to prevent stale flag values
  (2026-02-26)

### Patch Changes

- [#3145](https://github.com/PostHog/posthog-js/pull/3145) [`d741668`](https://github.com/PostHog/posthog-js/commit/d741668f6f966c729308d3b71fd7deebe16411f0) Thanks [@dmarticus](https://github.com/dmarticus)! - Adds a remote_config_refresh_interval_ms config option to control how often feature flags are automatically refreshed in long-running sessions.
  (2026-02-26)

## 1.355.0

## 1.354.4

## 1.354.3

## 1.354.2

## 1.354.1

## 1.354.0

## 1.353.1

## 1.353.0

## 1.352.1

## 1.352.0

## 1.351.4

### Patch Changes

- [#3119](https://github.com/PostHog/posthog-js/pull/3119) [`2649a9a`](https://github.com/PostHog/posthog-js/commit/2649a9a6eeef19c67036c1298b5b5b6ba61eda8e) Thanks [@dmarticus](https://github.com/dmarticus)! - Adds a fresh option to getFeatureFlag(), getFeatureFlagResult(), and isFeatureEnabled() that only returns values loaded from the server, not cached localStorage values.
  (2026-02-19)

## 1.351.3

## 1.351.2

## 1.351.1

## 1.351.0

### Patch Changes

- [#3107](https://github.com/PostHog/posthog-js/pull/3107) [`9dbc05e`](https://github.com/PostHog/posthog-js/commit/9dbc05ed65ddc8c37c9262b9aebfc51d0c748971) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - warning on manual capture('$exception')
  (2026-02-18)

## 1.350.0

### Minor Changes

- [#2895](https://github.com/PostHog/posthog-js/pull/2895) [`1b47203`](https://github.com/PostHog/posthog-js/commit/1b47203a5cc1b8f76e224101975e462cd777e2ee) Thanks [@benjackwhite](https://github.com/benjackwhite)! - RemoteConfig (config.js) has been loaded for ages and is in use by us in production. This PR makes it the sole config loading mechanism for posthog-js, removing the legacy /flags/?v=2&config=true path and the \_\_preview_remote_config gate.
  (2026-02-17)

## 1.349.0

### Minor Changes

- [#3105](https://github.com/PostHog/posthog-js/pull/3105) [`f707ec9`](https://github.com/PostHog/posthog-js/commit/f707ec95e4b718bffe48e3e6be9afbc855b39f8f) Thanks [@adboio](https://github.com/adboio)! - add support for product tours localization
  (2026-02-17)

## 1.348.0

## 1.347.2

## 1.347.1

## 1.347.0

## 1.346.0

## 1.345.5

### Patch Changes

- [#3060](https://github.com/PostHog/posthog-js/pull/3060) [`7437982`](https://github.com/PostHog/posthog-js/commit/7437982efa2c7a7a9ede563ddd97beba5c70d650) Thanks [@pauldambra](https://github.com/pauldambra)! - Add missing `featureFlags` property and `OverrideFeatureFlagsOptions` type to `PostHog` interface, restore `set_config` to the loaded callback type, and add `featureFlagsReloading` to `on()` event types
  (2026-02-11)

## 1.345.4

## 1.345.3

## 1.345.2

## 1.345.1

## 1.345.0

### Minor Changes

- [#2919](https://github.com/PostHog/posthog-js/pull/2919) [`fe8090c`](https://github.com/PostHog/posthog-js/commit/fe8090c00f0122ed4aad37465f43480c50392506) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Add `error` property to `RequestResponse`
  (2026-02-09)

## 1.344.0

## 1.343.2

## 1.343.1

## 1.343.0

## 1.342.1

## 1.342.0

## 1.341.2

## 1.341.1

## 1.341.0

## 1.340.0

## 1.339.1

## 1.339.0

### Minor Changes

- [#3006](https://github.com/PostHog/posthog-js/pull/3006) [`b3ec434`](https://github.com/PostHog/posthog-js/commit/b3ec4346e77917121c4fe7bfd966d09850df00f6) Thanks [@robbie-c](https://github.com/robbie-c)! - Add a function isTestUser() and config option test_user_hostname
  (2026-02-03)

## 1.338.1

## 1.338.0

## 1.337.1

## 1.337.0

### Minor Changes

- [#2996](https://github.com/PostHog/posthog-js/pull/2996) [`7768010`](https://github.com/PostHog/posthog-js/commit/77680105f1e8baf5ed1934d423494793d11ff01a) Thanks [@matheus-vb](https://github.com/matheus-vb)! - Filter out flags marked as failed before merging with cached values, preventing transient backend errors from overwriting previously evaluated flag states
  (2026-02-03)

## 1.336.4

## 1.336.3

## 1.336.2

## 1.336.1

## 1.336.0

### Minor Changes

- [#2954](https://github.com/PostHog/posthog-js/pull/2954) [`228930a`](https://github.com/PostHog/posthog-js/commit/228930a48b35f67cf12fc8dc155f431ff97b9f05) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: Add `FeatureFlagResult` type
  (2026-01-28)

## 1.335.5

## 1.335.4

## 1.335.3

## 1.335.2

## 1.335.1

## 1.335.0

### Minor Changes

- [#2953](https://github.com/PostHog/posthog-js/pull/2953) [`c8d3fbe`](https://github.com/PostHog/posthog-js/commit/c8d3fbe5e3a4944596d7a34086484affd94d7329) Thanks [@pauldambra](https://github.com/pauldambra)! - allows using web vitals with and without attribution
  (2026-01-23)

## 1.334.1

## 1.334.0

## 1.333.0

## 1.332.0

## 1.331.3

## 1.331.2

## 1.331.1

## 1.331.0

## 1.330.0

## 1.329.0

## 1.328.0

## 1.327.0

## 1.326.0

## 1.325.0

## 1.324.1

## 1.324.0

## 1.323.0

## 1.322.0

## 1.321.3

## 1.321.2

## 1.321.1

## 1.321.0

## 1.320.0

## 1.319.2

### Patch Changes

- [#2864](https://github.com/PostHog/posthog-js/pull/2864) [`f64ebef`](https://github.com/PostHog/posthog-js/commit/f64ebefe51b39d3c883f536624cc4b680fd2ba87) Thanks [@rafaeelaudibert](https://github.com/rafaeelaudibert)! - We were missing some public definitions inside `@posthog/types` so let's fix them here. We've also fixed the typing inside the `loaded` callback
  (2026-01-13)

## 1.319.1

## 1.319.0

## 1.318.2

## 1.318.1

## 1.318.0

### Minor Changes

- [#2870](https://github.com/PostHog/posthog-js/pull/2870) [`b703cbb`](https://github.com/PostHog/posthog-js/commit/b703cbbf2210d622b69492802f611877c04b2e4d) Thanks [@adboio](https://github.com/adboio)! - add missing sessionRecording types
  (2026-01-09)

## 1.317.1

## 1.317.0

## 1.316.1

## 1.316.0

## 1.315.1

## 1.315.0

### Minor Changes

- [#2839](https://github.com/PostHog/posthog-js/pull/2839) [`83b03fe`](https://github.com/PostHog/posthog-js/commit/83b03feb885d5d7def9afee6b1b915548bcf5278) Thanks [@rafaeelaudibert](https://github.com/rafaeelaudibert)! - Release new @posthog/types library to make it easy for those using the script version of `posthog-js` to properly type `window.posthog`
  (2026-01-06)
