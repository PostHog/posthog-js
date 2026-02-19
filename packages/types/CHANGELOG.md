# @posthog/types

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
