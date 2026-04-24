# @posthog/types

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
