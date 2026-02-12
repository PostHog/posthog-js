# posthog-react-native

## 4.34.0

### Minor Changes

- [#3084](https://github.com/PostHog/posthog-js/pull/3084) [`e2ac0e8`](https://github.com/PostHog/posthog-js/commit/e2ac0e856821a0b7e2e25c1142c602c4c138cbdd) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - add error boundary
  (2026-02-12)

## 4.33.0

### Minor Changes

- [#3065](https://github.com/PostHog/posthog-js/pull/3065) [`34ee954`](https://github.com/PostHog/posthog-js/commit/34ee95404fdae8c97f3263a600392caac5b982a8) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: Add `useFeatureFlagResult` hook
  (2026-02-12)

### Patch Changes

- [#3071](https://github.com/PostHog/posthog-js/pull/3071) [`d1d62d4`](https://github.com/PostHog/posthog-js/commit/d1d62d4e4a3653f0b93abcbd9f33567ed60e3547) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - fix: `PostHogContext` is correctly typed
  (2026-02-12)

## 4.32.0

### Minor Changes

- [#3045](https://github.com/PostHog/posthog-js/pull/3045) [`0acf16f`](https://github.com/PostHog/posthog-js/commit/0acf16fcbf8c32d5f28b86b6fa200271ad0b647e) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: Add `getFeatureFlagResult` to PostHogCore
  (2026-02-10)

### Patch Changes

- Updated dependencies [[`0acf16f`](https://github.com/PostHog/posthog-js/commit/0acf16fcbf8c32d5f28b86b6fa200271ad0b647e)]:
  - @posthog/core@1.22.0

## 4.31.1

### Patch Changes

- [#3070](https://github.com/PostHog/posthog-js/pull/3070) [`eca98ac`](https://github.com/PostHog/posthog-js/commit/eca98ac8da99210b69f67474189ca8720c76062b) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: export PostHogMaskView
  (2026-02-10)

## 4.31.0

### Minor Changes

- [#2820](https://github.com/PostHog/posthog-js/pull/2820) [`d578824`](https://github.com/PostHog/posthog-js/commit/d578824395ceba3b854970c2a7723e97466d9e9d) Thanks [@ordehi](https://github.com/ordehi)! - Add survey response validation for message length (min and max length). Fixes whitespace-only bypass for required questions. Existing surveys work unchanged but now properly reject blank responses.
  (2026-02-09)

### Patch Changes

- Updated dependencies [[`d578824`](https://github.com/PostHog/posthog-js/commit/d578824395ceba3b854970c2a7723e97466d9e9d)]:
  - @posthog/core@1.21.0

## 4.30.3

### Patch Changes

- [#3028](https://github.com/PostHog/posthog-js/pull/3028) [`e055f9a`](https://github.com/PostHog/posthog-js/commit/e055f9a344d7c11309c56444383f79df335a5c51) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: Queue pending feature flags reload instead of dropping requests when a reload is already in flight
  (2026-02-09)
- Updated dependencies [[`e055f9a`](https://github.com/PostHog/posthog-js/commit/e055f9a344d7c11309c56444383f79df335a5c51)]:
  - @posthog/core@1.20.2

## 4.30.2

### Patch Changes

- Updated dependencies [[`8f75dae`](https://github.com/PostHog/posthog-js/commit/8f75dae39ae2938624ca49e778915a92f2491556)]:
  - @posthog/core@1.20.1

## 4.30.1

### Patch Changes

- [#3031](https://github.com/PostHog/posthog-js/pull/3031) [`26775e2`](https://github.com/PostHog/posthog-js/commit/26775e2ac54b0b6e2356336a68daed35cb7cd6fc) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: prevent duplicate events with transactional storage (async) updates
  (2026-02-05)

## 4.30.0

### Minor Changes

- [#3023](https://github.com/PostHog/posthog-js/pull/3023) [`bb62809`](https://github.com/PostHog/posthog-js/commit/bb62809917845685ae7e2e6d5adad6be5528356e) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: only capture $set events if the user properties have changed
  (2026-02-04)

### Patch Changes

- Updated dependencies [[`bb62809`](https://github.com/PostHog/posthog-js/commit/bb62809917845685ae7e2e6d5adad6be5528356e)]:
  - @posthog/core@1.20.0

## 4.29.0

### Minor Changes

- [#3009](https://github.com/PostHog/posthog-js/pull/3009) [`c99e5fe`](https://github.com/PostHog/posthog-js/commit/c99e5feb043870357c8f722eb52542327c3f472b) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: add setPersonProperties method
  (2026-02-03)

### Patch Changes

- Updated dependencies [[`c99e5fe`](https://github.com/PostHog/posthog-js/commit/c99e5feb043870357c8f722eb52542327c3f472b)]:
  - @posthog/core@1.19.0

## 4.28.0

### Minor Changes

- [#2944](https://github.com/PostHog/posthog-js/pull/2944) [`578fc2a`](https://github.com/PostHog/posthog-js/commit/578fc2a83392a64028cde4187bfc0dcaf6f110c4) Thanks [@RayKay91](https://github.com/RayKay91)! - Allow for properties to be excluded from reset
  (2026-02-03)

### Patch Changes

- Updated dependencies [[`7768010`](https://github.com/PostHog/posthog-js/commit/77680105f1e8baf5ed1934d423494793d11ff01a)]:
  - @posthog/core@1.18.0

## 4.27.0

### Minor Changes

- [#2966](https://github.com/PostHog/posthog-js/pull/2966) [`727536c`](https://github.com/PostHog/posthog-js/commit/727536cf5f1ab5a8d21fa9d4e2e6b13efc851fca) Thanks [@adboio](https://github.com/adboio)! - support "always" survey schedule
  (2026-01-29)

### Patch Changes

- Updated dependencies [[`727536c`](https://github.com/PostHog/posthog-js/commit/727536cf5f1ab5a8d21fa9d4e2e6b13efc851fca)]:
  - @posthog/core@1.17.0

## 4.26.0

### Minor Changes

- [#2967](https://github.com/PostHog/posthog-js/pull/2967) [`cbe84c1`](https://github.com/PostHog/posthog-js/commit/cbe84c1ea8b6dd398569ed401139e9698e08fd64) Thanks [@adboio](https://github.com/adboio)! - support auto-submit on selection for survey rating questions
  (2026-01-29)

### Patch Changes

- Updated dependencies [[`cbe84c1`](https://github.com/PostHog/posthog-js/commit/cbe84c1ea8b6dd398569ed401139e9698e08fd64)]:
  - @posthog/core@1.16.0

## 4.25.0

### Minor Changes

- [#2983](https://github.com/PostHog/posthog-js/pull/2983) [`e925210`](https://github.com/PostHog/posthog-js/commit/e925210182f295f17f93ed0e1c3936ac010960d5) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: allow recording masking with a view wrapper and without accessibilitylabel
  (2026-01-29)

## 4.24.2

### Patch Changes

- Updated dependencies [[`8c0c495`](https://github.com/PostHog/posthog-js/commit/8c0c495caaf4cd7f950cbc77fdfc1df499772008)]:
  - @posthog/core@1.15.0

## 4.24.1

### Patch Changes

- [#2971](https://github.com/PostHog/posthog-js/pull/2971) [`f51560c`](https://github.com/PostHog/posthog-js/commit/f51560caf78386cef5278f7cf0e9f253b2ec0e50) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: groups and groupidentify is a no-op if person profiles is set to never
  (2026-01-27)
- Updated dependencies [[`f51560c`](https://github.com/PostHog/posthog-js/commit/f51560caf78386cef5278f7cf0e9f253b2ec0e50)]:
  - @posthog/core@1.14.1

## 4.24.0

### Minor Changes

- [#2917](https://github.com/PostHog/posthog-js/pull/2917) [`933c763`](https://github.com/PostHog/posthog-js/commit/933c7639ae30390ca562a0891d59649711b53522) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: add support for person_profiles react native, core and web-lite
  (2026-01-23)

### Patch Changes

- Updated dependencies [[`933c763`](https://github.com/PostHog/posthog-js/commit/933c7639ae30390ca562a0891d59649711b53522)]:
  - @posthog/core@1.14.0

## 4.23.0

### Minor Changes

- [#2882](https://github.com/PostHog/posthog-js/pull/2882) [`8a5a3d5`](https://github.com/PostHog/posthog-js/commit/8a5a3d5693facda62b90b66dead338f7dca19705) Thanks [@adboio](https://github.com/adboio)! - add support for question prefill in popover surveys, add useThumbSurvey hook
  (2026-01-20)

### Patch Changes

- Updated dependencies [[`8a5a3d5`](https://github.com/PostHog/posthog-js/commit/8a5a3d5693facda62b90b66dead338f7dca19705)]:
  - @posthog/core@1.13.0

## 4.22.0

### Minor Changes

- [#2897](https://github.com/PostHog/posthog-js/pull/2897) [`b7fa003`](https://github.com/PostHog/posthog-js/commit/b7fa003ef6ef74bdf4666be0748d89a5a6169054) Thanks [@matheus-vb](https://github.com/matheus-vb)! - Add $feature_flag_error to $feature_flag_called events to track flag evaluation failures
  (2026-01-20)

- [#2931](https://github.com/PostHog/posthog-js/pull/2931) [`f0cbc0d`](https://github.com/PostHog/posthog-js/commit/f0cbc0d8e4e5efc27d9595676e886d6d3d3892f4) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: before_send support for web lite and react native
  (2026-01-20)

### Patch Changes

- Updated dependencies [[`b7fa003`](https://github.com/PostHog/posthog-js/commit/b7fa003ef6ef74bdf4666be0748d89a5a6169054), [`f0cbc0d`](https://github.com/PostHog/posthog-js/commit/f0cbc0d8e4e5efc27d9595676e886d6d3d3892f4)]:
  - @posthog/core@1.12.0

## 4.21.0

### Minor Changes

- [#2900](https://github.com/PostHog/posthog-js/pull/2900) [`23770e9`](https://github.com/PostHog/posthog-js/commit/23770e9e2eed1aca5c2bc7a34a6d64dc115b0d11) Thanks [@dmarticus](https://github.com/dmarticus)! - Renamed `evaluationEnvironments` to `evaluationContexts` for clearer semantics. The term "contexts" better reflects that this feature is for specifying evaluation contexts (e.g., "web", "mobile", "checkout") rather than deployment environments (e.g., "staging", "production").

  ### Deprecated
  - `posthog.init` option `evaluationEnvironments` is now deprecated in favor of `evaluationContexts`. The old property will continue to work and will log a deprecation warning. It will be removed in a future major version.

  ### Migration Guide

  ````javascript
  // Before
  posthog.init('<ph_project_api_key>', {
      evaluationEnvironments: ['production', 'web', 'checkout'],
  })

  // After
  posthog.init('<ph_project_api_key>', {
      evaluationContexts: ['production', 'web', 'checkout'],
  })
  ``` (2026-01-19)
  ````

### Patch Changes

- Updated dependencies [[`23770e9`](https://github.com/PostHog/posthog-js/commit/23770e9e2eed1aca5c2bc7a34a6d64dc115b0d11)]:
  - @posthog/core@1.11.0

## 4.20.0

### Minor Changes

- [#2924](https://github.com/PostHog/posthog-js/pull/2924) [`298ac60`](https://github.com/PostHog/posthog-js/commit/298ac609d233e04a7a7423445b780ec8b7450245) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - allow disabling the plugin programmatically
  (2026-01-19)

## 4.19.0

### Minor Changes

- [#2881](https://github.com/PostHog/posthog-js/pull/2881) [`d37e570`](https://github.com/PostHog/posthog-js/commit/d37e5709863e869825df57d0854588140c4294b2) Thanks [@adboio](https://github.com/adboio)! - add support for thumbs up/down survey rating scale
  (2026-01-16)

### Patch Changes

- Updated dependencies [[`d37e570`](https://github.com/PostHog/posthog-js/commit/d37e5709863e869825df57d0854588140c4294b2)]:
  - @posthog/core@1.10.0

## 4.18.0

### Minor Changes

- [#2884](https://github.com/PostHog/posthog-js/pull/2884) [`66670ad`](https://github.com/PostHog/posthog-js/commit/66670adf56f5d909befd0aafb19419c650973eb5) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - disable injection for react native web platform
  (2026-01-13)

## 4.17.3

### Patch Changes

- Updated dependencies [[`fba9fb2`](https://github.com/PostHog/posthog-js/commit/fba9fb2ea4be2ea396730741b4718b4a2c80d026), [`c1ed63b`](https://github.com/PostHog/posthog-js/commit/c1ed63b0f03380a5e4bb2463491b3f767f64a514)]:
  - @posthog/core@1.9.1

## 4.17.2

### Patch Changes

- [#2833](https://github.com/PostHog/posthog-js/pull/2833) [`c7c3140`](https://github.com/PostHog/posthog-js/commit/c7c3140a20957d71072f355be4744a6cdb315360) Thanks [@ioannisj](https://github.com/ioannisj)! - fix expo web export build error
  (2025-12-31)

## 4.17.1

### Patch Changes

- [#2809](https://github.com/PostHog/posthog-js/pull/2809) [`8fd7c76`](https://github.com/PostHog/posthog-js/commit/8fd7c766efbc4c9445c4ce72cfb6b761520e7f1f) Thanks [@adboio](https://github.com/adboio)! - add control for keyboard avoiding behavior on android
  (2025-12-29)

## 4.17.0

### Minor Changes

- [#2787](https://github.com/PostHog/posthog-js/pull/2787) [`b676b4d`](https://github.com/PostHog/posthog-js/commit/b676b4d7342c8c3b64960aa55630b2810366014e) Thanks [@lucasheriques](https://github.com/lucasheriques)! - feat: allow customizing text colors on web and react native
  (2025-12-22)

### Patch Changes

- [#2791](https://github.com/PostHog/posthog-js/pull/2791) [`3e533de`](https://github.com/PostHog/posthog-js/commit/3e533de1e8b52f64fa28762114f4e279d2c55406) Thanks [@adboio](https://github.com/adboio)! - surveys fix: do not dismiss keyboard on submit button tap
  (2025-12-22)
- Updated dependencies [[`b676b4d`](https://github.com/PostHog/posthog-js/commit/b676b4d7342c8c3b64960aa55630b2810366014e)]:
  - @posthog/core@1.9.0

## 4.16.2

### Patch Changes

- [#2769](https://github.com/PostHog/posthog-js/pull/2769) [`6b0aabf`](https://github.com/PostHog/posthog-js/commit/6b0aabff893e44d1710b7d122a68bf023f4e0bd5) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: React Native on web should report hardware type as Desktop or Mobile, not Web
  (2025-12-17)
- Updated dependencies [[`6b0aabf`](https://github.com/PostHog/posthog-js/commit/6b0aabff893e44d1710b7d122a68bf023f4e0bd5)]:
  - @posthog/core@1.8.1

## 4.16.1

### Patch Changes

- [#2763](https://github.com/PostHog/posthog-js/pull/2763) [`c9c0e4d`](https://github.com/PostHog/posthog-js/commit/c9c0e4d658f73a022151a273f258df0201738219) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: captureTouches errors with reanimated styles
  (2025-12-17)

## 4.16.0

### Minor Changes

- [#2776](https://github.com/PostHog/posthog-js/pull/2776) [`32db4b3`](https://github.com/PostHog/posthog-js/commit/32db4b378c5d40747454085de135174c2c176849) Thanks [@adboio](https://github.com/adboio)! - support event property filters on surveys
  (2025-12-17)

## 4.15.0

### Minor Changes

- [#2774](https://github.com/PostHog/posthog-js/pull/2774) [`2603a8d`](https://github.com/PostHog/posthog-js/commit/2603a8d6e1021cd8f84e8b61be77ce268435ebde) Thanks [@adboio](https://github.com/adboio)! - fix survey text color on react native
  (2025-12-16)

### Patch Changes

- Updated dependencies [[`2603a8d`](https://github.com/PostHog/posthog-js/commit/2603a8d6e1021cd8f84e8b61be77ce268435ebde)]:
  - @posthog/core@1.8.0

## 4.14.4

### Patch Changes

- [#2764](https://github.com/PostHog/posthog-js/pull/2764) [`8368cbc`](https://github.com/PostHog/posthog-js/commit/8368cbcc3c29e362f2658e580f4956e0037469f7) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: posthog-cli finds the correct path on android gradle plugin
  (2025-12-16)

## 4.14.3

### Patch Changes

- [#2697](https://github.com/PostHog/posthog-js/pull/2697) [`0c3bd5e`](https://github.com/PostHog/posthog-js/commit/0c3bd5eb1fe7fa94bb78ed1282922d613cc37e95) Thanks [@robbie-c](https://github.com/robbie-c)! - Support getting locale and timezone from expo-localization >= 14
  (2025-12-05)

## 4.14.2

### Patch Changes

- [#2690](https://github.com/PostHog/posthog-js/pull/2690) [`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4) Thanks [@robbie-c](https://github.com/robbie-c)! - Related to https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182

  We didn't include any of the vulnerable deps in any of our packages, however we did have them as dev / test / example project dependencies.

  There was no way that any of these vulnerable packages were included in any of our published packages.

  We've now patched out those dependencies.

  Out of an abundance of caution, let's create a new release of all of our packages. (2025-12-04)

- Updated dependencies [[`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4)]:
  - @posthog/core@1.7.1

## 4.14.1

### Patch Changes

- Updated dependencies [[`e1617d9`](https://github.com/PostHog/posthog-js/commit/e1617d91255b23dc39b1dcb15b05ae64c735d9d0)]:
  - @posthog/core@1.7.0

## 4.14.0

### Minor Changes

- [#2613](https://github.com/PostHog/posthog-js/pull/2613) [`81781ba`](https://github.com/PostHog/posthog-js/commit/81781ba593be58fcd9c0f31c8fa8ef2693fd765c) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: expo plugin for react native error tracking.
  (2025-11-24)

## 4.13.0

### Minor Changes

- [#2619](https://github.com/PostHog/posthog-js/pull/2619) [`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86) Thanks [@hpouillot](https://github.com/hpouillot)! - package deprecation
  (2025-11-24)

### Patch Changes

- Updated dependencies [[`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86)]:
  - @posthog/core@1.6.0

## 4.12.5

### Patch Changes

- [#2618](https://github.com/PostHog/posthog-js/pull/2618) [`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe) Thanks [@marandaneto](https://github.com/marandaneto)! - last version was compromised
  (2025-11-24)
- Updated dependencies [[`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe)]:
  - @posthog/core@1.5.6

## 4.12.4

### Patch Changes

- [#2608](https://github.com/PostHog/posthog-js/pull/2608) [`bef494e`](https://github.com/PostHog/posthog-js/commit/bef494e55a711bc66e13cf94fe8e39a1f8bf72d1) Thanks [@ioannisj](https://github.com/ioannisj)! - fix: latest release on posthog-cli lookup when installed via npm for iOS source map uploads
  (2025-11-20)

## 4.12.3

### Patch Changes

- Updated dependencies [[`83f5d07`](https://github.com/PostHog/posthog-js/commit/83f5d07e4ae8c2ae5c6926858b6095ebbfaf319f)]:
  - @posthog/core@1.5.5

## 4.12.2

### Patch Changes

- Updated dependencies [[`c242702`](https://github.com/PostHog/posthog-js/commit/c2427029d75cba71b78e9822f18f5e73f7442288)]:
  - @posthog/core@1.5.4

## 4.12.1

### Patch Changes

- [#2575](https://github.com/PostHog/posthog-js/pull/2575) [`8acd88f`](https://github.com/PostHog/posthog-js/commit/8acd88f1b71d2c7e1222c43dd121abce78ef2bab) Thanks [@hpouillot](https://github.com/hpouillot)! - fix frame platform property for $exception events
  (2025-11-19)
- Updated dependencies [[`8acd88f`](https://github.com/PostHog/posthog-js/commit/8acd88f1b71d2c7e1222c43dd121abce78ef2bab)]:
  - @posthog/core@1.5.3

## 4.12.0

### Minor Changes

- [#2484](https://github.com/PostHog/posthog-js/pull/2484) [`d143cc4`](https://github.com/PostHog/posthog-js/commit/d143cc4606079ced995f41594e770addf87d0a7f) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: add hermes symbolication support for react native and error tracking

## 4.11.0

### Minor Changes

- [#2564](https://github.com/PostHog/posthog-js/pull/2564) [`ee01b17`](https://github.com/PostHog/posthog-js/commit/ee01b1727c5d4fb5cf2e2c8bb57062907e498445) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: Properties sent via `identify` and `group` are cached for flags calls

- [#2564](https://github.com/PostHog/posthog-js/pull/2564) [`ee01b17`](https://github.com/PostHog/posthog-js/commit/ee01b1727c5d4fb5cf2e2c8bb57062907e498445) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: `setDefaultPersonProperties` config option (default true) automatically includes common device and app properties in feature flag evaluation.

## 4.10.8

### Patch Changes

- Updated dependencies [[`87f9604`](https://github.com/PostHog/posthog-js/commit/87f96047739e67b847fe22137b97fc57f405b8d9)]:
  - @posthog/core@1.5.2

## 4.10.7

### Patch Changes

- [#2541](https://github.com/PostHog/posthog-js/pull/2541) [`b3a62d0`](https://github.com/PostHog/posthog-js/commit/b3a62d01aa62cc96cd4270adf1168a219f620ee7) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: deprecate navigationRef autocapture

- Updated dependencies [[`d8d98c9`](https://github.com/PostHog/posthog-js/commit/d8d98c95f24b612110dbf52d228c0c3bd248cd58)]:
  - @posthog/core@1.5.1

## 4.10.6

### Patch Changes

- Updated dependencies [[`068d55e`](https://github.com/PostHog/posthog-js/commit/068d55ed4193e82729cd34b42d9e433f85b6e606)]:
  - @posthog/core@1.5.0

## 4.10.5

### Patch Changes

- Updated dependencies [[`751b440`](https://github.com/PostHog/posthog-js/commit/751b44040c4c0c55a19df2ad0e5f215943620e51)]:
  - @posthog/core@1.4.0

## 4.10.4

### Patch Changes

- [#2493](https://github.com/PostHog/posthog-js/pull/2493) [`7ec7be5`](https://github.com/PostHog/posthog-js/commit/7ec7be5917090ae00f988035ff1e0f6f727e6660) Thanks [@ordehi](https://github.com/ordehi)! - **Bug Fixes:**
  - Fixed surveys with URL or CSS selector targeting incorrectly showing in React Native
    - **Breaking behavior change**: Surveys configured with URL or CSS selector targeting will no longer appear in React Native apps (this was always the intended behavior)
    - **Action required**: If you have surveys that should show in React Native, remove URL/selector conditions and use feature flags or device type targeting instead

## 4.10.3

### Patch Changes

- Updated dependencies [[`e0a6fe0`](https://github.com/PostHog/posthog-js/commit/e0a6fe013b5a1e92a6e7685f35f715199b716b34)]:
  - @posthog/core@1.3.1

## 4.10.2

### Patch Changes

- [#2457](https://github.com/PostHog/posthog-js/pull/2457) [`7f5e94b`](https://github.com/PostHog/posthog-js/commit/7f5e94b3839e9c6ef8363b9296993ca11e3319ad) Thanks [@daibhin](https://github.com/daibhin)! - correctly export error tracking files

## 4.10.1

### Patch Changes

- [#2415](https://github.com/PostHog/posthog-js/pull/2415) [`ab30675`](https://github.com/PostHog/posthog-js/commit/ab30675f9fcb9323dfbc8447fd5b244a0a631983) Thanks [@ioannisj](https://github.com/ioannisj)! - fix surveys only appear on subsequent app launches after being loaded and cached

## 4.10.0

### Minor Changes

- [#2417](https://github.com/PostHog/posthog-js/pull/2417) [`daf919b`](https://github.com/PostHog/posthog-js/commit/daf919be225527ee4ad026d806dec195b75e44aa) Thanks [@dmarticus](https://github.com/dmarticus)! - feat: Add evaluation environments support for feature flags

  This PR implements support for evaluation environments in the posthog-react-native SDK, allowing users to specify which environment tags their SDK instance should use when evaluating feature flags.

  Users can now configure the SDK with an `evaluationEnvironments` option:

  ```typescript
  const posthog = new PostHog('api-key', {
    host: 'https://app.posthog.com',
    evaluationEnvironments: ['production', 'mobile', 'react-native'],
  })
  ```

  When set, only feature flags that have at least one matching evaluation tag will be evaluated for this SDK instance. Feature flags with no evaluation tags will always be evaluated.

### Patch Changes

- [#2431](https://github.com/PostHog/posthog-js/pull/2431) [`7d45a7a`](https://github.com/PostHog/posthog-js/commit/7d45a7a52c44ba768913d66a4c4363d107042682) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: remove deprecated attribute $exception_personURL from exception events

- Updated dependencies [[`daf919b`](https://github.com/PostHog/posthog-js/commit/daf919be225527ee4ad026d806dec195b75e44aa), [`7d45a7a`](https://github.com/PostHog/posthog-js/commit/7d45a7a52c44ba768913d66a4c4363d107042682)]:
  - @posthog/core@1.3.0

## 4.9.1

### Patch Changes

- Updated dependencies [[`10da2ee`](https://github.com/PostHog/posthog-js/commit/10da2ee0b8862ad0e32b68e452fae1bc77620bbf)]:
  - @posthog/core@1.2.4

## 4.9.0

### Minor Changes

- [#2410](https://github.com/PostHog/posthog-js/pull/2410) [`1f294ec`](https://github.com/PostHog/posthog-js/commit/1f294ecb3c816b283f04c0dacc01739d79a5805c) Thanks [@hpouillot](https://github.com/hpouillot)! - add error tracking autocapture

## 4.8.1

### Patch Changes

- [#2414](https://github.com/PostHog/posthog-js/pull/2414) [`e19a384`](https://github.com/PostHog/posthog-js/commit/e19a384468d722c12f4ef21feb684da31f9dcd3b) Thanks [@hpouillot](https://github.com/hpouillot)! - create a common logger for node and react-native

- Updated dependencies [[`e19a384`](https://github.com/PostHog/posthog-js/commit/e19a384468d722c12f4ef21feb684da31f9dcd3b)]:
  - @posthog/core@1.2.3

## 4.8.0

### Minor Changes

- [#2360](https://github.com/PostHog/posthog-js/pull/2360) [`8ea1ce8`](https://github.com/PostHog/posthog-js/commit/8ea1ce8a9d02de35e2c1bea3f49518455fb53ffe) Thanks [@hpouillot](https://github.com/hpouillot)! - add stacktrace to exceptions

## 4.7.1

### Patch Changes

- Updated dependencies [[`5820942`](https://github.com/PostHog/posthog-js/commit/582094255fa87009b02a4e193c3e63ef4621d9d0)]:
  - @posthog/core@1.2.2

## 4.7.0

### Minor Changes

- [#2352](https://github.com/PostHog/posthog-js/pull/2352) [`c01c728`](https://github.com/PostHog/posthog-js/commit/c01c728616673e20cd4b91a6050c0e194908c4b3) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: rn surveys use the new response question id format

## 4.6.3

### Patch Changes

- Updated dependencies [[`caecb94`](https://github.com/PostHog/posthog-js/commit/caecb94493f6b85003ecbd6750a81e27139b1fa5)]:
  - @posthog/core@1.2.1

## 4.6.2

### Patch Changes

- Updated dependencies [[`ac48d8f`](https://github.com/PostHog/posthog-js/commit/ac48d8fda3a4543f300ced705bce314a206cce6f)]:
  - @posthog/core@1.2.0

## 4.6.1

### Patch Changes

- Updated dependencies [[`da07e41`](https://github.com/PostHog/posthog-js/commit/da07e41ac2307803c302557a12b459491657a75f)]:
  - @posthog/core@1.1.0

## 4.6.0

### Minor Changes

- [#2328](https://github.com/PostHog/posthog-js/pull/2328) [`83196aa`](https://github.com/PostHog/posthog-js/commit/83196aa4bb7f7a1642b722cbfa19af1bb13379ae) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: add support for throttleDelayMs

## 4.5.1

### Patch Changes

- [#2325](https://github.com/PostHog/posthog-js/pull/2325) [`a9121df`](https://github.com/PostHog/posthog-js/commit/a9121dfbbe4c549e786124b1a8905c598fada757) Thanks [@marandaneto](https://github.com/marandaneto)! - surveys on react native web renders and get focused correctly

## 4.5.0

### Minor Changes

- [#2239](https://github.com/PostHog/posthog-js/pull/2239) [`637f6fd`](https://github.com/PostHog/posthog-js/commit/637f6fd3817eac5c9c91cd55ee3e24a252ed5669) Thanks [@ioannisj](https://github.com/ioannisj)! - add support for conditional survey questions

## 4.4.3

### Patch Changes

- Updated dependencies [[`1981815`](https://github.com/PostHog/posthog-js/commit/19818159b7074098150bc79cfa2962761a14cb46)]:
  - @posthog/core@1.0.2

## 4.4.2

### Patch Changes

- [#2219](https://github.com/PostHog/posthog-js/pull/2219) [`44d10c4`](https://github.com/PostHog/posthog-js/commit/44d10c46c5378fa046320b7c50bd046eb1e75994) Thanks [@daibhin](https://github.com/daibhin)! - update @posthog/core

- Updated dependencies [[`44d10c4`](https://github.com/PostHog/posthog-js/commit/44d10c46c5378fa046320b7c50bd046eb1e75994)]:
  - @posthog/core@1.0.1

## 4.4.1

### Patch Changes

- [#2234](https://github.com/PostHog/posthog-js/pull/2234) [`9ef2193`](https://github.com/PostHog/posthog-js/commit/9ef21939209a822a2f974dfb6604368ec2e44c49) Thanks [@marandaneto](https://github.com/marandaneto)! - expo-43 and new expo-file-system APIs with back compatibility support

## 4.4.0

### Minor Changes

- [#2192](https://github.com/PostHog/posthog-js/pull/2192) [`dec3f44`](https://github.com/PostHog/posthog-js/commit/dec3f443465787216ee3015aa254c5312659ad3f) Thanks [@marandaneto](https://github.com/marandaneto)! - survey support for feature flag variants

## 4.3.1

### Patch Changes

- [#2180](https://github.com/PostHog/posthog-js/pull/2180) [`7c849d5`](https://github.com/PostHog/posthog-js/commit/7c849d5482e537c17b6fa2a1eb8e5d70e8c830bb) Thanks [@ioannisj](https://github.com/ioannisj)! - fix emoji rating row wrap

## 4.3.0

### Minor Changes

- [#2129](https://github.com/PostHog/posthog-js/pull/2129) [`a3d1267`](https://github.com/PostHog/posthog-js/commit/a3d1267b7904171ee132ce8d0d2a59a0936e1a4e) Thanks [@marandaneto](https://github.com/marandaneto)! - Remove legacy migration code, left over from the V1 to V2 migration

## 4.2.2 - 2025-07-23

### Fixed

1. Fix issue with expo-file-system on web and macos

## 4.2.1 - 2025-07-21

### Fixed

1. Solve outdated JSX transform warning

## 4.2.0 - 2025-07-15

### Changed

1. Add more documentation for the `captureScreens` option and its usage with expo-router, @react-navigation/native and react-native-navigation

## 4.1.5 - 2025-07-14

### Fixed

1. read the navigation ref from the current property if it exists for expo-router and @react-navigation/native

## 4.1.4 - 2025-07-01

### Fixed

1. avoid navigation tracking crash when using the new navigation version

## 4.1.3 - 2025-06-26

### Fixed

1. Multiple choice question response
2. Survey button disabled style

## 4.1.2 - 2025-06-24

### Fixed

1. Force session replay to use string values for sessionId, distinctId and anonymousId

## 4.1.1 - 2025-06-23

### Fixed

1. Add missing survey position types

## 4.1.0 - 2025-06-12

1. chore: use `/flags?v=2&config=true` instead of `/decide?v=4` for the flag evaluation backend

## 4.0.0 - 2025-06-10

### Removed

1. Remove `captureMode` in favor of `json` capture mode only
2. Remove deprecated `personProperties` and `groupProperties` in favor of `setPersonPropertiesForFlags` and `setGroupPropertiesForFlags`
3. Rename `captureNativeAppLifecycleEvents` option to `captureAppLifecycleEvents`
   1. `captureAppLifecycleEvents` from `autocapture` is removed and replaced by `captureAppLifecycleEvents` from options
4. Remove `version` and `build` from Lifecycle events in favor of `$app_version` and `$app_build`
5. Remove maskPhotoLibraryImages from the SDK config

## 3.16.1 – 2025-05-28

### Fixed

1. rotate session id if expired when the app is back from background

## 3.16.0 – 2025-05-27

### Fixed

1. rotate session id if expired after 24 hours

## 3.15.4 – 2025-05-20

### Fixed

1. session recording respects linked flags

## 3.15.3 – 2025-05-14

### Fixed

1. chore: improve event prop types
2. use custom allSettled implementation to avoid issues with patching Promise

## 3.15.2 – 2025-05-07

### Fixed

1. survey modal closes when clicking inside the modal

## 3.15.1 – 2025-04-28

### Fixed

1. revert migration to rollup

## 3.15.0 – 2025-04-23

1. chore: migrate to bundle using rollup

Do not use this version, please use [3.15.1](https://github.com/PostHog/posthog-js-lite/releases/tag/posthog-react-native-v3.15.1) instead.

## 3.14.0 – 2025-04-17

1. chore: roll out new feature flag evaluation backend to majority of customers

## 3.13.2 - 2025-04-16

### Fixed

1. react native navigation missing navigationRef

## 3.13.1 - 2025-04-15

### Fixed

1. broken relative imports for surveys

## 3.13.0 - 2025-04-08

## Added

1. `$feature_flag_called` event now includes additional properties such as `feature_flag_id`, `feature_flag_version`, `feature_flag_reason`, and `feature_flag_request_id`.

### Fixed

1. apiKey cannot be empty.
2. Survey modal now moves up when the keyboard is open.

## 3.12.0 - 2025-03-13

## Added

1. Adds support for [surveys on react native](https://github.com/PostHog/posthog.com/pull/10843/)
   1. Thanks @ian-craig for initial PR.

## 3.11.2 - 2025-02-27

### Fixed

1. Supports gracefully handling quotaLimited responses from the PostHog API for feature flags.

## 3.11.1 - 2025-02-21

### Fixed

1. fix: handle cases when non Error is passed to `captureException`

## 3.11.0 - 2025-02-21

1. fix: Autocapture native app lifecycle events
   1. the `captureNativeAppLifecycleEvents` client option now takes priority over the `captureLifecycleEvents` autocapture option.
   2. the `captureLifecycleEvents` autocapture option now captures Application Installed and Application Updated events.
   3. If you don't want to capture these events, set the `captureLifecycleEvents` autocapture option to `false` and capture the events manually, example below.

```js
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    posthog.capture('Application Became Active')
  } else if (state === 'background') {
    posthog.capture('Application Backgrounded')
  }
})
```

## 3.10.0 - 2025-02-20

## Added

1. Adds the ability to capture user feedback in LLM Observability using the `captureTraceFeedback` and `captureTraceMetric` methods.

## 3.9.1 - 2025-02-13

1. fix: ensure feature flags are reloaded after reset() to prevent undefined values

## 3.9.0 - 2025-02-07

1. chore: Session Replay - GA

## 3.8.0 - 2025-02-06

## Added

1. Adds `captureException` function to allow basic manual capture of JavaScript exceptions

## 3.7.0 - 2025-02-05

1. chore: set locale and timezone using the react-native-localize library

## 3.6.4 - 2025-02-03

1. fix: improve session replay linked flag type handling

## 3.6.3 - 2025-01-16

1. fix: session replay respect linked feature flags

## 3.6.2 - 2025-01-13

1. fix: Set initial currentSessionId, log only with debug flag on

## 3.6.1 - 2024-12-17

1. fix: os_name was not being set correctly for some devices using expo-device

## 3.6.0 - 2024-12-12

1. Add new debugging property `$feature_flag_bootstrapped_response`, `$feature_flag_bootstrapped_payload` and `$used_bootstrap_value` to `$feature_flag_called` event

## 3.5.0 - 2024-12-03

1. fix: deprecate maskPhotoLibraryImages due to unintended masking issues

## 3.4.0 - 2024-11-26

1. feat: automatically mask out user photos and sandboxed views like photo picker (iOS Only)
   1. To disable masking set `maskAllSandboxedViews` and `maskPhotoLibraryImages` to false

```js
export const posthog = new PostHog(
  'apiKey...',
  sessionReplayConfig: {
      maskAllSandboxedViews: false,
      maskPhotoLibraryImages: false,
);
```

## 3.3.14 - 2024-11-21

1. fix: identify method allows passing a $set_once object

## 3.3.13 - 2024-11-19

1. fix: session replay respects the flushAt flag

## 3.3.12 - 2024-11-18

1. fix: session replay forces the session id if the SDK is already enabled

## 3.3.11 - 2024-11-13

1. fix: respect the given propsToCapture autocapture option

## 3.3.10 - 2024-11-04

1. fix: capture customLabelProp if set

## 3.3.9 - 2024-10-26

1. fix: rollback module to ESNext

## 3.3.8 - 2024-10-25

1. chore: change androidDebouncerDelayMs default from 500ms to 1000ms (1s)

## 3.3.7 - 2024-10-25

1. fix: session replay respects the `disabled` flag

## 3.3.6 - 2024-10-19

1. fix: all sdkReplayConfig should have a default value

## 3.3.5 - 2024-10-15

1. fix: only tries to read device context from react-native-device-info if expo libs are not available

## 3.3.4 - 2024-10-14

1. fix: only log messages if debug is enabled

## 3.3.3 - 2024-10-11

1. fix: bootstrap flags do not overwrite the current values

## 3.3.2 - 2024-10-11

### Changed

1. fix: clear flagCallReported if there are new flags

## 3.3.1 - 2024-09-30

### Changed

1. fix: set the right sdk name and version for recordings

## 3.3.0 - 2024-09-24

### Changed

1. chore: session id will be rotate on app restart.
   1. To keep the session id across restarts, set the `enablePersistSessionIdAcrossRestart` option to `true` when initializing the PostHog client.

```js
export const posthog = new PostHog('apiKey...', {
  // ...
  enablePersistSessionIdAcrossRestart: true,
})
```

## 3.2.1 - 2024-09-24

### Changed

1. recording: session replay plugin isn't properly identifying users already identified

## 3.2.0 - 2024-09-19

### Changed

1. chore: default `captureMode` changed to `json`.
   1. To keep using the `form` mode, just set the `captureMode` option to `form` when initializing the PostHog client.
2. chore: Session Replay for React-Native - Experimental support

Install Session Replay for React-Native:

```bash
yarn add posthog-react-native-session-replay
## or npm
npm i -s posthog-react-native-session-replay
```

Enable Session Replay for React-Native:

```js
export const posthog = new PostHog('apiKey...', {
  // ...
  enableSessionReplay: true,
})
```

Or using the `PostHogProvider`

```js
<PostHogProvider
        apiKey="apiKey..."
        options={{
          enableSessionReplay: true,
        }}
      >
```

## 3.1.2 - 2024-08-14

### Changed

1. chore: change host to new address.

## 3.1.1 - 2024-04-25

1. Prevent double JSON parsing of feature flag payloads, which would convert the payload [1] into 1.

## 3.1.0 - 2024-03-27

### Changed

1. If `captureNativeAppLifecycleEvents` is enabled, the event `Application Opened` with the property `from_background: true` is moved to its own event called `Application Became Active`. This event is triggered when the app is opened from the background. The `Application Opened` event is now only triggered when the app is opened from a cold start, aligning with the other integrations such as the `PostHogProvider` with the `captureLifecycleEvents` option and `initReactNativeNavigation` with the `captureLifecycleEvents` option.

## 3.0.0 - 2024-03-18

## Added

1. Adds a `disabled` option and the ability to change it later via `posthog.disabled = true`. Useful for disabling PostHog tracking for example in a testing environment without having complex conditional checking
2. `shutdown` takes a `shutdownTimeoutMs` param with a default of 30000 (30s). This is the time to wait for flushing events before shutting down the client. If the timeout is reached, the client will be shut down regardless of pending events.
3. Adds a new `featureFlagsRequestTimeoutMs` timeout parameter for feature flags which defaults to 10 seconds.
4. Flushes will now try to flush up to `maxBatchSize` (default 100) in one go
5. Sets `User-Agent` headers with SDK name and version for RN
6. Queued events are limited up to `maxQueueSize` (default 1000) and the oldest events are dropped when the limit is reached

### Removed

1. `flushAsync` and `shutdownAsync` are removed with `flush` and `shutdown` now being the async methods.
2. Removes the `enable` option. You can now specify `defaultOptIn: false` to start the SDK opted out of tracking
3. `PostHog.initAsync` is no more! You can now initialize PostHog as you would any other class `const posthog = new PostHog(...)`

### Changed

1. PostHogProvider now requires either an `apiKey` or `client` property and `usePostHog` now always returns a `PostHog` instance instead of `PostHog | undefined`. The `disabled` option can be used when initializing the `PostHogProvider` if desired and all subsequent calls to `posthog` will work but without actually doing anything.
2. `flush` and `shutdown` now being async methods.
3. Replaces the option `customAsyncStorage` with `customStorage` to allow for custom synchronous or asynchronous storage implementations.

### Fixed

1. Many methods such as `capture` and `identify` no longer return the `this` object instead returning nothing
2. Fixed an issue where `shutdown` would potentially exit early if a flush was already in progress
3. Fixes some typos in types

## 3.0.0-beta.3 - 2024-03-13

1. Sets `User-Agent` headers with SDK name and version for RN
2. fix: PostHogProvider initialization that requires client `or` apiKey and not `and`.

## 3.0.0-beta.2 - 2024-03-12

1. `flushAsync` and `shutdownAsync` are removed with `flush` and `shutdown` now being the async methods.
2. Fixed an issue where `shutdownAsync` would potentially exit early if a flush was already in progress
3. Flushes will now try to flush up to `maxBatchSize` (default 100) in one go

## 3.0.0-beta.1 - 2024-03-04

1. `PostHog.initAsync` is no more! You can now initialize PostHog as you would any other class `const posthog = new PostHog(...)`
2. PostHogProvider now requires either an `apiKey` or `client` property and `usePostHog` now always returns a `PostHog` instance instead of `PostHog | undefined`. The `disabled` option can be used when initializing the `PostHogProvider` if desired and all subsequent calls to `posthog` will work but without actually doing anything.
3. Removes the `enable` option. You can now specify `defaultOptIn: false` to start the SDK opted out of tracking
4. Adds a `disabled` option and the ability to change it later via `posthog.disabled = true`. Useful for disabling PostHog tracking for example in a testing environment without having complex conditional checking
5. Many methods such as `capture` and `identify` no longer return the `this` object instead returning nothing
6. Fixes some typos in types
7. `shutdown` and `shutdownAsync` takes a `shutdownTimeoutMs` param with a default of 30000 (30s). This is the time to wait for flushing events before shutting down the client. If the timeout is reached, the client will be shut down regardless of pending events.
8. Adds a new `featureFlagsRequestTimeoutMs` timeout parameter for feature flags which defaults to 10 seconds.
9. Replaces the option `customAsyncStorage` with `customStorage` to allow for custom synchronous or asynchronous storage implementations.

## 2.11.6 - 2024-02-22

1. `$device_name` was set to the device's user name (eg Max's iPhone) for all events wrongly, it's now set to the device's name (eg iPhone 12), this happened only if using `react-native-device-info` library.
2. Fixes an issue related to other dependencies patching the global Promise object that could lead to crashes

## 2.11.5 - 2024-02-20

1. fix: undefined posthog in hooks

## 2.11.4 - 2024-02-15

1. fix: using `captureMode=form` won't throw an error and retry unnecessarily
2. `$app_build` was returning the OS internal build number instead of the app's build number.
3. This flag was used to track app versions, you might experience a sudden increase of `Application Updated` events, but only if you're using the `react-native-device-info` library.

## 2.11.3 - 2024-02-08

1. Vendor `uuidv7` instead of using peer dependency to avoid the missing crypto issue

## 2.11.2 - 2024-02-06

1. Swapped to `uuidv7` for unique ID generation

## 2.11.1 - 2024-01-25

1. Do not try to load packages on the macOS target that are not supported.
2. Use `Platform.select` instead `Platform.OS` for conditional imports which avoids issues such as `Unable to resolve module`.

## 2.11.0 - 2024-01-23

1. Adds support for overriding the event `uuid` via capture options

## 2.10.2 - 2024-01-22

1. Do not try to load the `expo-file-system` package on the Web target since it's not supported.
2. if `react-native-device-info` is available for the Web target, do not set `unknown` for all properties.

## 2.10.1 - 2024-01-15

1. The `tag_name` property of auto-captured events now uses the nearest `ph-label` from parent elements, if present.

## 2.10.0 - 2024-01-08

1. `$device_type` is now set to `Mobile`, `Desktop`, or `Web` for all events

## 2.9.2 - 2023-12-21

1. If `async-storage` or `expo-file-system` is not installed, the SDK will fallback to `persistence: memory` and log a warning

## 2.9.1 - 2023-12-14

1. `getPersistedProperty` uses Nullish Coalescing operator to fallback to `undefined` only if the property is not found

## 2.9.0 - 2023-12-04

1. Renamed `personProperties` to `setPersonPropertiesForFlags` to match `posthog-js` and more clearly indicated what it does
2. Renamed `groupProperties` to `setGroupPropertiesForFlags` to match `posthog-js` and more clearly indicated what it does

## 2.8.1 - 2023-10-09

1. Fixes a type generation issue

## 2.8.0 - 2023-10-06

1. Added new `const [flag, payload] = useFeatureFlagWithPayload('my-flag-name')` hook that returns the flag result and it's payload if it has one.

## 2.7.1 - 2023-05-25

1. The `$screen_name` property will be registered for all events whenever `screen` is called

## 2.7.0 - 2023-04-21

1. Fixes a race condition that could occur when initialising PostHog
2. Fixes an issue where feature flags would not be reloaded after a reset
3. PostHog should always be initialized via .initAsync and will now warn if this is not the case

## 2.6.0 - 2023-04-19

1. Some small fixes to incorrect types
2. Fixed fetch compatibility by aligning error handling
3. Added two errors: PostHogFetchHttpError (non-2xx status) and PostHogFetchNetworkError (fetch network error)
4. Added .on('error', (err) => void)
5. shutdownAsync now ignores fetch errors. They should be handled with .on('error', ...) from now on.

## 2.5.2 - 2023-02-13

1. Fixes an issue where background network errors would trigger unhandled promise warnings

## 2.5.1 - 2023-02-03

1. Added support for customising the default app properties by passing a function to `options.customAppProperties`

## 2.5.0 - 2023-02-02

1. Adds support for overriding timestamp of capture events

## 2.4.0 - 2023-01-27

1. Adds support for https://github.com/wix/react-native-navigation
2. Allows passing of promise based `PostHog.initAsync` to `<PostHogProvider client={...} />`
3. Captures text content in autocapture (configurable via autocapture option `propsToCapture`)

## 2.3.0 - 2022-1-26

1. uses v3 decide endpoint
2. JSON payloads will be returned with feature flags
3. Feature flags will gracefully fail and optimistically save evaluated flags if server is down

## 2.2.3 - 2023-01-25

1. Ensures the distinctId used in `.groupIdentify` is the same as the currently identified user

## 2.2.2 - 2023-01-05

1. Fixes an issue with PostHogProvider where autocapture={false} would still capture lifecycle and navigation events.

## 2.2.1 - 2022-11-21

1. Fixes an issue with async storage selection while installing PostHog React Native
2. Fixes an issue where React Hooks for feature flags were conditionally loaded

## 2.2.0 - 2022-11-11

1. Expo modules are no longer required. Expo apps work as before and standalone React Native apps can use the more common native dependencies or roll their own implementation of the necessary functions. See the [official docs](https://posthog.com/docs/integrate/client/react-native) for more information.
2. PostHog should now be initialised via the async helper `PostHog.initAsync` to ensure persisted data is loaded before any tracking takes place

## 2.1.4 - 2022-10-28

Also include the fix in the compiled `lib` folder.

## 2.1.3 - 2022-10-27

Actually include the fix.

## 2.1.2 - 2022-10-27

Fix bug where all values set while stored data was being loaded would get overwritten once the data was done loading.

## 2.1.1 - 2022-09-09

Support for bootstrapping feature flags and distinctIDs. This allows you to initialise the library with a set of feature flags and distinctID that are immediately available.

## 2.1.0 - 2022-09-02

PostHogProvider `autocapture` can be configured with `captureLifecycleEvents: false` and `captureScreens: false` if you want do disable these autocapture elements. Both of these default to `true`
