# posthog-node

## 5.24.9

### Patch Changes

- Updated dependencies [[`c99e5fe`](https://github.com/PostHog/posthog-js/commit/c99e5feb043870357c8f722eb52542327c3f472b)]:
  - @posthog/core@1.19.0

## 5.24.8

### Patch Changes

- Updated dependencies [[`7768010`](https://github.com/PostHog/posthog-js/commit/77680105f1e8baf5ed1934d423494793d11ff01a)]:
  - @posthog/core@1.18.0

## 5.24.7

### Patch Changes

- Updated dependencies [[`727536c`](https://github.com/PostHog/posthog-js/commit/727536cf5f1ab5a8d21fa9d4e2e6b13efc851fca)]:
  - @posthog/core@1.17.0

## 5.24.6

### Patch Changes

- Updated dependencies [[`cbe84c1`](https://github.com/PostHog/posthog-js/commit/cbe84c1ea8b6dd398569ed401139e9698e08fd64)]:
  - @posthog/core@1.16.0

## 5.24.5

### Patch Changes

- [#2987](https://github.com/PostHog/posthog-js/pull/2987) [`25f4173`](https://github.com/PostHog/posthog-js/commit/25f4173e01fd026cb71f036ce2bfb7caa6cb637d) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: before_send in node inferred the type as any instead of EventMessage or null
  (2026-01-29)

## 5.24.4

### Patch Changes

- Updated dependencies [[`8c0c495`](https://github.com/PostHog/posthog-js/commit/8c0c495caaf4cd7f950cbc77fdfc1df499772008)]:
  - @posthog/core@1.15.0

## 5.24.3

### Patch Changes

- Updated dependencies [[`f51560c`](https://github.com/PostHog/posthog-js/commit/f51560caf78386cef5278f7cf0e9f253b2ec0e50)]:
  - @posthog/core@1.14.1

## 5.24.2

### Patch Changes

- Updated dependencies [[`933c763`](https://github.com/PostHog/posthog-js/commit/933c7639ae30390ca562a0891d59649711b53522)]:
  - @posthog/core@1.14.0

## 5.24.1

### Patch Changes

- Updated dependencies [[`8a5a3d5`](https://github.com/PostHog/posthog-js/commit/8a5a3d5693facda62b90b66dead338f7dca19705)]:
  - @posthog/core@1.13.0

## 5.24.0

### Minor Changes

- [#2897](https://github.com/PostHog/posthog-js/pull/2897) [`b7fa003`](https://github.com/PostHog/posthog-js/commit/b7fa003ef6ef74bdf4666be0748d89a5a6169054) Thanks [@matheus-vb](https://github.com/matheus-vb)! - Add $feature_flag_error to $feature_flag_called events to track flag evaluation failures
  (2026-01-20)

### Patch Changes

- Updated dependencies [[`b7fa003`](https://github.com/PostHog/posthog-js/commit/b7fa003ef6ef74bdf4666be0748d89a5a6169054), [`f0cbc0d`](https://github.com/PostHog/posthog-js/commit/f0cbc0d8e4e5efc27d9595676e886d6d3d3892f4)]:
  - @posthog/core@1.12.0

## 5.23.0

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

## 5.22.0

### Minor Changes

- [#2930](https://github.com/PostHog/posthog-js/pull/2930) [`c9b773a`](https://github.com/PostHog/posthog-js/commit/c9b773aefd25fcc81a60dff02348e8e724b87565) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: Bump node min. ^20.20.0 || >=22.22.0 due to https://nodejs.org/en/blog/vulnerability/january-2026-dos-mitigation-async-hooks
  (2026-01-19)

## 5.21.2

### Patch Changes

- [#2920](https://github.com/PostHog/posthog-js/pull/2920) [`099ee0c`](https://github.com/PostHog/posthog-js/commit/099ee0c3e4babc632abf52ecdc1df700c6087566) Thanks [@haacked](https://github.com/haacked)! - Add getFeatureFlagResult method to retrieve flag value and payload in a single API call.
  (2026-01-19)

## 5.21.1

### Patch Changes

- Updated dependencies [[`d37e570`](https://github.com/PostHog/posthog-js/commit/d37e5709863e869825df57d0854588140c4294b2)]:
  - @posthog/core@1.10.0

## 5.21.0

### Minor Changes

- [#2883](https://github.com/PostHog/posthog-js/pull/2883) [`640fcdd`](https://github.com/PostHog/posthog-js/commit/640fcdd2dd7f412630190aa6fdecc4418246a87e) Thanks [@ordehi](https://github.com/ordehi)! - Add warning when experience continuity flags are detected during local evaluation, and new `strictLocalEvaluation` option.

  **Warning:** When using local evaluation with flags that have experience continuity enabled, a warning is now emitted explaining that these flags will cause server requests on every evaluation, negating local evaluation cost savings.

  **New option:** `strictLocalEvaluation: true` can be set at client init to prevent all server fallback for flag evaluations. Flags that cannot be evaluated locally will return `undefined` instead of making a server request. This is useful in high-volume environments where you want to guarantee no unexpected server costs. (2026-01-14)

## 5.20.0

### Minor Changes

- [#2593](https://github.com/PostHog/posthog-js/pull/2593) [`fba9fb2`](https://github.com/PostHog/posthog-js/commit/fba9fb2ea4be2ea396730741b4718b4a2c80d026) Thanks [@daibhin](https://github.com/daibhin)! - track LLMA trace_id on exceptions and exception_id on traces
  (2026-01-08)

### Patch Changes

- Updated dependencies [[`fba9fb2`](https://github.com/PostHog/posthog-js/commit/fba9fb2ea4be2ea396730741b4718b4a2c80d026), [`c1ed63b`](https://github.com/PostHog/posthog-js/commit/c1ed63b0f03380a5e4bb2463491b3f767f64a514)]:
  - @posthog/core@1.9.1

## 5.19.0

### Minor Changes

- [#2840](https://github.com/PostHog/posthog-js/pull/2840) [`84e4140`](https://github.com/PostHog/posthog-js/commit/84e4140a1cdb10a10eb4fc13ded9392d7fd8836b) Thanks [@ordehi](https://github.com/ordehi)! - Add overrideFeatureFlags() method for local testing and development
  (2026-01-06)

## 5.18.1

### Patch Changes

- [#2825](https://github.com/PostHog/posthog-js/pull/2825) [`5a4a8e2`](https://github.com/PostHog/posthog-js/commit/5a4a8e23eddb034f6a77e3cdccdd84db2c5d3a4a) Thanks [@haacked](https://github.com/haacked)! - getFeatureFlag() respects exponential backoff for HTTP 401, 403, and 429 responses.
  (2025-12-30)

## 5.18.0

### Minor Changes

- [#2782](https://github.com/PostHog/posthog-js/pull/2782) [`04065b9`](https://github.com/PostHog/posthog-js/commit/04065b9942da4545553859af5195587e5348bceb) Thanks [@haacked](https://github.com/haacked)! - Add $feature_flag_error to $feature_flag_called events when an error occurred while trying evaluate a flag
  (2025-12-22)

### Patch Changes

- Updated dependencies [[`b676b4d`](https://github.com/PostHog/posthog-js/commit/b676b4d7342c8c3b64960aa55630b2810366014e)]:
  - @posthog/core@1.9.0

## 5.17.4

### Patch Changes

- Updated dependencies [[`6b0aabf`](https://github.com/PostHog/posthog-js/commit/6b0aabff893e44d1710b7d122a68bf023f4e0bd5)]:
  - @posthog/core@1.8.1

## 5.17.3

### Patch Changes

- Updated dependencies [[`2603a8d`](https://github.com/PostHog/posthog-js/commit/2603a8d6e1021cd8f84e8b61be77ce268435ebde)]:
  - @posthog/core@1.8.0

## 5.17.2

### Patch Changes

- [#2678](https://github.com/PostHog/posthog-js/pull/2678) [`ca4436e`](https://github.com/PostHog/posthog-js/commit/ca4436ecdca2412b1d068bcd3d5fcaf60bd2b114) Thanks [@haacked](https://github.com/haacked)! - Local evaluation polling sends If-None-Match header with latest etag to reduce bandwidth when no flags have changed.
  (2025-12-04)

## 5.17.1

### Patch Changes

- [#2690](https://github.com/PostHog/posthog-js/pull/2690) [`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4) Thanks [@robbie-c](https://github.com/robbie-c)! - Related to https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182

  We didn't include any of the vulnerable deps in any of our packages, however we did have them as dev / test / example project dependencies.

  There was no way that any of these vulnerable packages were included in any of our published packages.

  We've now patched out those dependencies.

  Out of an abundance of caution, let's create a new release of all of our packages. (2025-12-04)

- Updated dependencies [[`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4)]:
  - @posthog/core@1.7.1

## 5.17.0

### Minor Changes

- [#2671](https://github.com/PostHog/posthog-js/pull/2671) [`a1dde5c`](https://github.com/PostHog/posthog-js/commit/a1dde5c443292f0c290ecad9042912e56101f82d) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - make contexts inherit by default
  (2025-12-03)

## 5.16.0

### Minor Changes

- [#2603](https://github.com/PostHog/posthog-js/pull/2603) [`e1617d9`](https://github.com/PostHog/posthog-js/commit/e1617d91255b23dc39b1dcb15b05ae64c735d9d0) Thanks [@dmarticus](https://github.com/dmarticus)! - add $feature_flag_evaluated_at properties to $feature_flag_called events
  (2025-12-03)

### Patch Changes

- Updated dependencies [[`e1617d9`](https://github.com/PostHog/posthog-js/commit/e1617d91255b23dc39b1dcb15b05ae64c735d9d0)]:
  - @posthog/core@1.7.0

## 5.15.0

### Minor Changes

- [#2614](https://github.com/PostHog/posthog-js/pull/2614) [`2be0eb3`](https://github.com/PostHog/posthog-js/commit/2be0eb34da5c910230c08e2d88c1219ecb0d2556) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - fix: Improve cache initialization performance
  (2025-12-01)

- [#2588](https://github.com/PostHog/posthog-js/pull/2588) [`ef589b6`](https://github.com/PostHog/posthog-js/commit/ef589b660d596a4a254b0f7f51e5125b50a7ac78) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - add context support
  (2025-12-01)

## 5.14.1

### Patch Changes

- [#2636](https://github.com/PostHog/posthog-js/pull/2636) [`922afaf`](https://github.com/PostHog/posthog-js/commit/922afaf977fccabc20fac873e16046ce4fdefda5) Thanks [@hpouillot](https://github.com/hpouillot)! - forward session and distinct id in express error handler
  (2025-11-28)

## 5.14.0

### Minor Changes

- [#2619](https://github.com/PostHog/posthog-js/pull/2619) [`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86) Thanks [@hpouillot](https://github.com/hpouillot)! - package deprecation
  (2025-11-24)

### Patch Changes

- Updated dependencies [[`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86)]:
  - @posthog/core@1.6.0

## 5.13.3

### Patch Changes

- [#2618](https://github.com/PostHog/posthog-js/pull/2618) [`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe) Thanks [@marandaneto](https://github.com/marandaneto)! - last version was compromised
  (2025-11-24)
- Updated dependencies [[`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe)]:
  - @posthog/core@1.5.6

## 5.13.2

### Patch Changes

- Updated dependencies [[`83f5d07`](https://github.com/PostHog/posthog-js/commit/83f5d07e4ae8c2ae5c6926858b6095ebbfaf319f)]:
  - @posthog/core@1.5.5

## 5.13.1

### Patch Changes

- Updated dependencies [[`c242702`](https://github.com/PostHog/posthog-js/commit/c2427029d75cba71b78e9822f18f5e73f7442288)]:
  - @posthog/core@1.5.4

## 5.13.0

### Minor Changes

- [#2600](https://github.com/PostHog/posthog-js/pull/2600) [`8972000`](https://github.com/PostHog/posthog-js/commit/89720003c495d7813c3117da42a3e2f73cc92d96) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - fix: `fetch` is called without a bound context

  This prevents issues in edge runtimes such as Cloudflare (2025-11-19)

### Patch Changes

- [#2575](https://github.com/PostHog/posthog-js/pull/2575) [`8acd88f`](https://github.com/PostHog/posthog-js/commit/8acd88f1b71d2c7e1222c43dd121abce78ef2bab) Thanks [@hpouillot](https://github.com/hpouillot)! - fix frame platform property for $exception events
  (2025-11-19)
- Updated dependencies [[`8acd88f`](https://github.com/PostHog/posthog-js/commit/8acd88f1b71d2c7e1222c43dd121abce78ef2bab)]:
  - @posthog/core@1.5.3

## 5.12.0

### Minor Changes

- [#2594](https://github.com/PostHog/posthog-js/pull/2594) [`4ad3678`](https://github.com/PostHog/posthog-js/commit/4ad3678b8ab575923fe703bd4066f2ca8be4de98) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: Add `FlagDefinitionCacheProvider` interface and client configuration option

## 5.11.2

### Patch Changes

- Updated dependencies [[`87f9604`](https://github.com/PostHog/posthog-js/commit/87f96047739e67b847fe22137b97fc57f405b8d9)]:
  - @posthog/core@1.5.2

## 5.11.1

### Patch Changes

- Updated dependencies [[`d8d98c9`](https://github.com/PostHog/posthog-js/commit/d8d98c95f24b612110dbf52d228c0c3bd248cd58)]:
  - @posthog/core@1.5.1

## 5.11.0

### Minor Changes

- [#2520](https://github.com/PostHog/posthog-js/pull/2520) [`068d55e`](https://github.com/PostHog/posthog-js/commit/068d55ed4193e82729cd34b42d9e433f85b6e606) Thanks [@lricoy](https://github.com/lricoy)! - Add bot pageview collection behind preview flag. Enables tracking bot traffic as `$bot_pageview` events when the `__preview_capture_bot_pageviews` flag is enabled.

### Patch Changes

- Updated dependencies [[`068d55e`](https://github.com/PostHog/posthog-js/commit/068d55ed4193e82729cd34b42d9e433f85b6e606)]:
  - @posthog/core@1.5.0

## 5.10.4

### Patch Changes

- Updated dependencies [[`751b440`](https://github.com/PostHog/posthog-js/commit/751b44040c4c0c55a19df2ad0e5f215943620e51)]:
  - @posthog/core@1.4.0

## 5.10.3

### Patch Changes

- Updated dependencies [[`e0a6fe0`](https://github.com/PostHog/posthog-js/commit/e0a6fe013b5a1e92a6e7685f35f715199b716b34)]:
  - @posthog/core@1.3.1

## 5.10.2

### Patch Changes

- [#2470](https://github.com/PostHog/posthog-js/pull/2470) [`a581328`](https://github.com/PostHog/posthog-js/commit/a581328156d6ee50804cd740aa84c05d4e9c1f22) Thanks [@luke-belton](https://github.com/luke-belton)! - Fix crash caused by calling `getFeatureFlagPayloads` for a flag that depends on a static cohort

## 5.10.1

### Patch Changes

- [#2465](https://github.com/PostHog/posthog-js/pull/2465) [`1721aba`](https://github.com/PostHog/posthog-js/commit/1721aba7e30d1f4a3f5a3f9c1ce35af5af0a4583) Thanks [@haacked](https://github.com/haacked)! - Fix bug where flag doesn't fallback to the server correctly when one condition is a static cohort condition but a later condition matches.

## 5.10.0

### Minor Changes

- [#2417](https://github.com/PostHog/posthog-js/pull/2417) [`daf919b`](https://github.com/PostHog/posthog-js/commit/daf919be225527ee4ad026d806dec195b75e44aa) Thanks [@dmarticus](https://github.com/dmarticus)! - feat: Add evaluation environments support for feature flags

  This PR implements support for evaluation environments in the posthog-node SDK, allowing users to specify which environment tags their SDK instance should use when evaluating feature flags.

  Users can now configure the SDK with an `evaluationEnvironments` option:

  ```typescript
  const client = new PostHog('api-key', {
    host: 'https://app.posthog.com',
    evaluationEnvironments: ['production', 'backend', 'api'],
  })
  ```

  When set, only feature flags that have at least one matching evaluation tag will be evaluated for this SDK instance. Feature flags with no evaluation tags will always be evaluated.

### Patch Changes

- [#2431](https://github.com/PostHog/posthog-js/pull/2431) [`7d45a7a`](https://github.com/PostHog/posthog-js/commit/7d45a7a52c44ba768913d66a4c4363d107042682) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: remove deprecated attribute $exception_personURL from exception events

- Updated dependencies [[`daf919b`](https://github.com/PostHog/posthog-js/commit/daf919be225527ee4ad026d806dec195b75e44aa), [`7d45a7a`](https://github.com/PostHog/posthog-js/commit/7d45a7a52c44ba768913d66a4c4363d107042682)]:
  - @posthog/core@1.3.0

## 5.9.5

### Patch Changes

- Updated dependencies [[`10da2ee`](https://github.com/PostHog/posthog-js/commit/10da2ee0b8862ad0e32b68e452fae1bc77620bbf)]:
  - @posthog/core@1.2.4

## 5.9.4

### Patch Changes

- [#2414](https://github.com/PostHog/posthog-js/pull/2414) [`e19a384`](https://github.com/PostHog/posthog-js/commit/e19a384468d722c12f4ef21feb684da31f9dcd3b) Thanks [@hpouillot](https://github.com/hpouillot)! - create a common logger for node and react-native

- Updated dependencies [[`e19a384`](https://github.com/PostHog/posthog-js/commit/e19a384468d722c12f4ef21feb684da31f9dcd3b)]:
  - @posthog/core@1.2.3

## 5.9.3

### Patch Changes

- [#2406](https://github.com/PostHog/posthog-js/pull/2406) [`ea58d34`](https://github.com/PostHog/posthog-js/commit/ea58d34c62e139f11d5b41bf67b52624308deffa) Thanks [@dmarticus](https://github.com/dmarticus)! - Use `SubtleCrypto` directly to compute SHA-1 hashes, fix "module not found" warning in edge runtimes.

## 5.9.2

### Patch Changes

- [#2370](https://github.com/PostHog/posthog-js/pull/2370) [`5820942`](https://github.com/PostHog/posthog-js/commit/582094255fa87009b02a4e193c3e63ef4621d9d0) Thanks [@hpouillot](https://github.com/hpouillot)! - remove testing from posthog-core

- Updated dependencies [[`5820942`](https://github.com/PostHog/posthog-js/commit/582094255fa87009b02a4e193c3e63ef4621d9d0)]:
  - @posthog/core@1.2.2

## 5.9.1

### Patch Changes

- [#2356](https://github.com/PostHog/posthog-js/pull/2356) [`caecb94`](https://github.com/PostHog/posthog-js/commit/caecb94493f6b85003ecbd6750a81e27139b1fa5) Thanks [@hpouillot](https://github.com/hpouillot)! - use core error tracking processing

- Updated dependencies [[`caecb94`](https://github.com/PostHog/posthog-js/commit/caecb94493f6b85003ecbd6750a81e27139b1fa5)]:
  - @posthog/core@1.2.1

## 5.9.0

### Minor Changes

- [#2348](https://github.com/PostHog/posthog-js/pull/2348) [`ac48d8f`](https://github.com/PostHog/posthog-js/commit/ac48d8fda3a4543f300ced705bce314a206cce6f) Thanks [@hpouillot](https://github.com/hpouillot)! - chore: align js syntax with package support

### Patch Changes

- Updated dependencies [[`ac48d8f`](https://github.com/PostHog/posthog-js/commit/ac48d8fda3a4543f300ced705bce314a206cce6f)]:
  - @posthog/core@1.2.0

## 5.8.8

### Patch Changes

- [#2350](https://github.com/PostHog/posthog-js/pull/2350) [`a1ae750`](https://github.com/PostHog/posthog-js/commit/a1ae750ee37fad9b91579dc38310e23e790b2fcd) Thanks [@andyzzhao](https://github.com/andyzzhao)! - feature flag local evaluation will not sort condition sets with variant overrides to the top

## 5.8.7

### Patch Changes

- fix: don't sort condition sets with variant overrides to the top - conditions are now evaluated in their original order to match server-side logic

## 5.8.6

### Patch Changes

- [#2346](https://github.com/PostHog/posthog-js/pull/2346) [`117b150`](https://github.com/PostHog/posthog-js/commit/117b15034e2740f5714b9bb249d8701c3f14c688) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: node onException autocapture safely access the exception_List

## 5.8.5

### Patch Changes

- Updated dependencies [[`da07e41`](https://github.com/PostHog/posthog-js/commit/da07e41ac2307803c302557a12b459491657a75f)]:
  - @posthog/core@1.1.0

## 5.8.4

### Patch Changes

- [#2312](https://github.com/PostHog/posthog-js/pull/2312) [`dff84c6`](https://github.com/PostHog/posthog-js/commit/dff84c6c21af9a8f4e3bfb58b4fb85ae2cbcdbc6) Thanks [@daibhin](https://github.com/daibhin)! - chore: allow PostHog exception capture to be skipped in Sentry integration

## 5.8.3

### Patch Changes

- [#2306](https://github.com/PostHog/posthog-js/pull/2306) [`30873bc`](https://github.com/PostHog/posthog-js/commit/30873bcc6ee8a46a4c2811684a24ced425ecc6fc) Thanks [@haacked](https://github.com/haacked)! - Fix memory leak when calling getAllFlags and getAllFlagsAndPayloads

## 5.8.2

### Patch Changes

- [#2285](https://github.com/PostHog/posthog-js/pull/2285) [`20c1b38`](https://github.com/PostHog/posthog-js/commit/20c1b38147242989ed805462ff87eb770843ef10) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - `getFeatureFlag` and `isFeatureEnabled` now respect the `sendFeatureFlagEvent` client option if not explicitly specified when called.

- [#2285](https://github.com/PostHog/posthog-js/pull/2285) [`20c1b38`](https://github.com/PostHog/posthog-js/commit/20c1b38147242989ed805462ff87eb770843ef10) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - The `sendFeatureFlagEvents` option for `getFeatureFlagPayload` is now marked as deprecated as it is not used.

## 5.8.1

### Patch Changes

- [#2243](https://github.com/PostHog/posthog-js/pull/2243) [`1981815`](https://github.com/PostHog/posthog-js/commit/19818159b7074098150bc79cfa2962761a14cb46) Thanks [@hpouillot](https://github.com/hpouillot)! - - fix error handling on process crash
  - fix exception flushing
- Updated dependencies [[`1981815`](https://github.com/PostHog/posthog-js/commit/19818159b7074098150bc79cfa2962761a14cb46)]:
  - @posthog/core@1.0.2

## 5.8.0

### Minor Changes

- [#2219](https://github.com/PostHog/posthog-js/pull/2219) [`44d10c4`](https://github.com/PostHog/posthog-js/commit/44d10c46c5378fa046320b7c50bd046eb1e75994) Thanks [@daibhin](https://github.com/daibhin)! - add exception rate limiter

### Patch Changes

- Updated dependencies [[`44d10c4`](https://github.com/PostHog/posthog-js/commit/44d10c46c5378fa046320b7c50bd046eb1e75994)]:
  - @posthog/core@1.0.1

## 5.7.0

### Minor Changes

- [#2218](https://github.com/PostHog/posthog-js/pull/2218) [`cfe1e94`](https://github.com/PostHog/posthog-js/commit/cfe1e9416a26919b096b0bf8a4e363f1fa448e7c) Thanks [@oliverb123](https://github.com/oliverb123)! - Added before_send function

## 5.6.0 – 2025-07-15

1. Added support for filtering feature flags with flagKeys parameter in sendFeatureFlags options

## 5.5.1 – 2025-07-15

1. wrap `InconclusiveMatchError`s in `logMsgIfDebug` for local flag evaluations on `sendFeatureFlags`

## 5.5.0 – 2025-07-10

1. feat: make the `sendFeatureFlags` parameter more declarative and ergonomic. Implementation notes below:

Modified `sendFeatureFlags` to be type `boolean | SendFeatureFlagsOptions`, (which is defined thusly)

```ts
export interface SendFeatureFlagsOptions {
  onlyEvaluateLocally?: boolean
  personProperties?: Record<string, any>
  groupProperties?: Record<string, Record<string, any>>
}
```

This lets users declare (1) whether to use local evaluation, and (2) which properties to supply explicitly for that evaluation, every time they want to send feature flags. It also supports the old boolean behavior if folks don't care and would rather the SDK infer it.

Now, you can make calls like this

```ts
posthog.captureImmediate({
  distinctId: 'user123',
  event: 'test event',
  sendFeatureFlags: {
    onlyEvaluateLocally: true,
    personProperties: {
      plan: 'premium',
    },
  },
  properties: {
    foo: 'bar',
  },
})
```

or simply

```
posthog.captureImmediate({
  distinctId: "user123",
  event: "test event",
  sendFeatureFlags: true // this will still infer local evaluation if it appears to be configured, but it won't try to pull properties from the event message
  properties: {
    foo: "bar",
  },
});
```

## 5.4.0 – 2025-07-09

feat: respect local evaluation preferences with `sendFeatureFlags`; add property overrides from the event to those local computations so that the locally evaluated flags can be more accuratee. NB: this change chagnes the default behavior of `capture` and `captureImmediately` – we will now only send feature flag data along with those events if `sendFeatureFlags` is explicitly specified, instead of optimistically sending along locally evaluated flags by default.

## 5.3.1 - 2025-07-07

1. feat: decouple feature flag local evaluation from personal API keys; support decrypting remote config payloads without relying on the feature flags poller

## 5.2.1 - 2025-07-07

1. feat: add captureExceptionImmediate method on posthog client

## 5.1.1 - 2025-06-16

1. fix: Handle double-encoded JSON payloads from the remote config endpoint

## 5.1.0 - 2025-06-12

1. chore: use `/flags?v=2&config=true` instead of `/decide?v=4` for the flag evaluation backend

## 5.0.0 - 2025-06-10

### Removed

1. Remove `is_simple_flag` from `PostHogFeatureFlag` type
2. Remove `captureMode` in favor of `json` capture mode only
3. Remove deprecated `personProperties` and `groupProperties` in favor of `setPersonPropertiesForFlags` and `setGroupPropertiesForFlags`

### Breaking changes

1. feat: migrate to native fetch, Node 20+ required
2. PostHog Node now compresses messages with GZip before sending them to our servers when the runtime supports compression. This reduces network bandwidth and improves performance. Network traffic interceptors and test assertions on payloads must handle GZip decompression to inspect the data. Alternatively, you can disable compression by setting `disableCompression: true` in the client configuration during tests.

## 5.0.0-alpha.1 - 2025-04-29

### Breaking changes

1. feat: migrate to native fetch, Node 18+ required

### Added

1. rotate session id if expired after 24 hours

## 4.17.2 - 2025-05-22

1. chore: improve event prop types
2. fix: no throw in sendImmediate

## 4.17.1 - 2025-05-02

1. fix: fix imports for old node.js version

## 4.17.0 - 2025-05-02

1. fix: specific exports for edge environments

## 4.16.0 - 2025-05-01

1. chore: improve flush event

## 4.15.0 - 2025-04-30

1. chore: add immediate-mode
2. chore: better error logging when flushing events

## 4.14.0 - 2025-04-24

1. feat: Add super properties as a concept to the Node SDK

## 4.13.0 - 2025-04-21

1. feat: Add method to wait for local evaluation feature flag definitions to be loaded

## 4.12.0 – 2025-04-17

1. chore: roll out new feature flag evaluation backend to majority of customers

## 4.11.7 - 2025-04-16

1. fix: do not reference `node:` prefix as it is not supported by Next.js edge runtime

## 4.11.6 - 2025-04-15

### Fixed

1. move survey export top-level declarations

## 4.11.5 - 2025-04-14

### Fixed

1. export and declare top-level declarations for surveys

## 4.11.4 - 2025-04-14

### Fixed

1. export top-level declarations for surveys

## 4.11.3 - 2025-04-08

### Fixed

1. do not access `fs` or `readline` in when not available e.g. edge environments

## 4.11.2 - 2025-04-07

### Fixed

1. chore: bump axios to 1.8.2 (fixes [CVE-2025-27152](https://github.com/advisories/GHSA-jr5f-v2jv-69x6))

## 4.11.1 - 2025-03-28

### Fixed

1. `getFeatureFlag`, `isFeatureEnabled`, and `getAllFlagsAndPayloads` now return `undefined` if the flag is not found.

## 4.11.0 - 2025-03-28

### Added

1. `$feature_flag_called` event now includes additional properties such as `feature_flag_id`, `feature_flag_version`, `feature_flag_reason`, and `feature_flag_request_id`.

### Fixed

1. apiKey cannot be empty.

## 4.10.2 - 2025-03-06

1. Add: log error message when feature flags have computation errors.

## 4.10.1 – 2025-03-06

1. Fix: only set `platform` on PostHog exception frame properties
1. Fix: prevent fetch floods when rate-limited.

## 4.10.0 – 2025-03-06

1. Attach requestId to $feature_flag_called if present in /decide response

## 4.9.0 – 2025-03-04

1. Allow feature flags to be evaluated individually when local evaluation is not being used

## 4.8.1 – 2025-02-26

1. Supports gracefully handling quotaLimited responses from the PostHog API for feature flag evaluation

## 4.8.0 - 2025-02-26

1. Add guardrails and exponential error backoff in the feature flag local evaluation poller to prevent high rates of 401/403 traffic towards `/local_evaluation`

## 4.7.0 - 2025-02-20

### Added

1. Adds the ability to capture user feedback in LLM Observability using the `captureTraceFeedback` and `captureTraceMetric` methods.

## 4.6.0 - 2025-02-12

### Added

1. Adds ability to fetch decrypted remote config flag payloads via `getRemoteConfigPayload`

## 4.5.2 - 2025-02-12

### Fixed

1. fix: Fixed edge case where `$feature_flag_called` events were enriched with additional feature flag data when they shouldn't be.

## 4.5.1 - 2025-02-12

### Fixed

1. Do not require a `distinctId` as an argument to `captureException`

## 4.5.0 - 2025-02-06

### Added

1. Adds manual exception capture with full stack trace processing via `captureException` function
2. Adds ability to enable exception autocapture via the `enableExceptionAutocapture` init option

## 4.4.1 - 2025-01-21

- Add option privacyMode to remove input and output from LLM Observability

## 4.4.0 - 2025-01-15

Switch from rusha to native (node:crypto) sha1 implementation

## 4.3.2 - 2024-12-11

1. REVERT: Fix bug where this SDK incorrectly sent `$feature_flag_called` events with null values when using `getFeatureFlagPayload`.

## 4.3.1 - 2024-11-26

1. Fix bug where this SDK incorrectly sent `$feature_flag_called` events with null values when using `getFeatureFlagPayload`.

## 4.3.0 - 2024-11-25

1. Add Sentry v8 support to the Sentry integration

## 4.2.3 - 2024-11-21

1. fix: identify method allows passing a $set_once object

## 4.2.2 - 2024-11-18

1. fix: Shutdown will now respect the timeout and forcefully return rather than returning after the next fetch.

## 4.2.1 - 2024-10-14

1. fix: only log messages if debug is enabled

## 4.2.0 - 2024-08-26

1. Added `historicalMigration` option for use in tools that are migrating large data to PostHog

## 4.1.1 - 2024-08-20

1. Local evaluation returns correct results on `undefined/null` values

## 4.1.0 - 2024-08-14

1. chore: change host to new address.
2. chore: bump axios to 1.7.4 (fixes [CVE-2024-39338](https://github.com/advisories/GHSA-8hc4-vh64-cxmj))

## 4.0.1 - 2024-04-25

1. Prevent double JSON parsing of feature flag payloads, which would convert the payload [1] into 1.

## 4.0.0 - 2024-03-18

### Added

1. Adds a `disabled` option and the ability to change it later via `posthog.disabled = true`. Useful for disabling PostHog tracking for example in a testing environment without having complex conditional checking
2. Adds a new `featureFlagsRequestTimeoutMs` timeout parameter for feature flags which defaults to 3 seconds, updated from the default 10s for all other API calls.
3. `shutdown` takes a `shutdownTimeoutMs` param with a default of 30000 (30s). This is the time to wait for flushing events before shutting down the client. If the timeout is reached, the client will be shut down regardless of pending events.
4. Flushes will now try to flush up to `maxBatchSize` (default 100) in one go
5. Queued events are limited up to `maxQueueSize` (default 1000) and the oldest events are dropped when the limit is reached
6. Sets `User-Agent` headers with SDK name and version for RN

## Removed

1. `flushAsync` and `shutdownAsync` are removed with `flush` and `shutdown` now being the async methods.

## Changed

1. `flush` and `shutdown` now being async methods.

### Fixed

1. Fixed an issue where `shutdown` would potentially exit early if a flush was already in progress
2. Fixes some typos in types

## 4.0.0-beta.3 - 2024-03-13

1. Sets `User-Agent` headers with SDK name and version for RN

## 4.0.0-beta.2 - 2024-03-12

1. `flushAsync` and `shutdownAsync` are removed with `flush` and `shutdown` now being the async methods.
2. Fixed an issue where `shutdown` would potentially exit early if a flush was already in progress
3. Flushes will now try to flush up to `maxBatchSize` (default 100) in one go

## 4.0.0-beta.1 - 2024-03-04

1. Adds a `disabled` option and the ability to change it later via `posthog.disabled = true`. Useful for disabling PostHog tracking for example in a testing environment without having complex conditional checking
2. Fixes some typos in types
3. `shutdown` and `shutdownAsync` takes a `shutdownTimeoutMs` param with a default of 30000 (30s). This is the time to wait for flushing events before shutting down the client. If the timeout is reached, the client will be shut down regardless of pending events.
4. Adds a new `featureFlagsRequestTimeoutMs` timeout parameter for feature flags which defaults to 3 seconds, updated from the default 10s for all other API calls.

## 3.6.3 - 2024-02-15

1. fix: using `captureMode=form` won't throw an error and retry unnecessarily

## 3.6.2 - 2024-02-06

1. Swapped to `uuidv7` for unique ID generation

## 3.6.1 - 2024-01-26

1. Remove new relative date operators, combine into regular date operators

## 3.6.0 - 2024-01-18

1. Adds support for overriding the event `uuid`

## 3.5.0 - 2024-01-09

1. When local evaluation is enabled, we automatically add flag information to all events sent to PostHog, whenever possible. This makes it easier to use these events in experiments.
2. Fixes a bug where in some rare cases we may drop events when send_feature_flags is enabled on capture.

## 3.4.0 - 2024-01-09

1. Numeric property handling for feature flags now does the expected: When passed in a number, we do a numeric comparison. When passed in a string, we do a string comparison. Previously, we always did a string comparison.
2. Add support for relative date operators for local evaluation.

## 3.3.0 - 2024-01-02

1. Adds PostHogSentryIntegration to allow automatic capturing of exceptions reported via the @sentry/node package

## 3.2.1 - 2023-12-15

1. Fixes issue where a background refresh of feature flags could throw an unhandled error. It now emits to be detected by `.on('error', ...)`

## 3.2.0 - 2023-12-05

1. Fixes issues with Axios imports for non-node environments like Cloudflare workers
2. Uses the globally defined `fetch` if available, otherwise imports and uses axios as a polyfill

## 3.1.3 - 2023-10-27

1. Updates axios dependency

## 3.1.2 - 2023-08-17

1. Returns the current flag property with $feature_flag_called events, to make it easier to use in experiments

## 3.1.1 - 2023-04-26

1. Replace crypto library with pure-js rusha library which makes posthog-node work with Cloudflare Workers in Next.js edge runtime.

## 3.1.0 - 2023-04-19

1. Some small fixes to incorrect types
2. Fixed fetch compatibility by aligning error handling
3. Added two errors: PostHogFetchHttpError (non-2xx status) and PostHogFetchNetworkError (fetch network error)
4. Added .on('error', (err) => void)
5. shutdownAsync now ignores fetch errors. They should be handled with .on('error', ...) from now on.

## 3.0.0 - 2023-04-14

Breaking change:

All events by default now send the `$geoip_disable` property to disable geoip lookup in app. This is because usually we don't
want to update person properties to take the server's location.

The same now happens for feature flag requests, where we discard the IP address of the server for matching on geoip properties like city, country, continent.

To restore previous behaviour, you can set the default to False like so:

```javascript
const posthog = new PostHog(PH_API_KEY, {
  host: PH_HOST,
  disableGeoip: false,
})
```

## 2.6.0 - 2023-03-14

1. Add support for all cohorts local evaluation in feature flags.

## 2.5.4 - 2023-02-27

1. Fix error log for local evaluation of feature flags (InconclusiveMatchError(s)) to only show during debug mode.

## 2.5.3 - 2023-02-21

1. Allow passing in a distinctId to `groupIdentify()`.
2. Fix a bug with active feature flags on capture events, where non-active flags would be added to the list as well.

## 2.5.2 - 2023-02-17

1. Fix issue where properties passed to `.identify` were not set correctly

## 2.5.1 - 2023-02-16

1. Make sure shutdown waits for pending promises to resolve. Fixes a problem with using PostHog Node in serverless environments.

## 2.5.0 - 2023-02-15

1. Removes shared client from `posthog-node`, getting rid of some race condition bugs when capturing events.
2. Sets minimum version of node.js to 15

## 2.4.0 - 2023-02-02

1. Adds support for overriding timestamp of capture events

## 2.3.0 - 2023-1-26

1. uses v3 decide endpoint
2. JSON payloads will be returned with feature flags
3. Feature flags will gracefully fail and optimistically save evaluated flags if server is down

## 2.2.3 - 2022-12-01

1. Fix issues with timeouts for local evaluation requests

## 2.2.2 - 2022-11-28

1. Fix issues with timeout

## 2.2.1 - 2022-11-24

1. Add standard 10 second timeout

## 2.2.0 - 2022-11-18

1. Add support for variant overrides for feature flag local evaluation.
2. Add support for date operators in feature flag local evaluation.

## 2.1.0 - 2022-09-08

1. Swaps `unidici` for `axios` in order to support older versions of Node
2. The `fetch` implementation can be overridden as an option for those who wish to use an alternative implementation
3. Fixes the minimum Node version to >=14.17.0

## 2.0.2 - 2022-08-23

1. Removes references to `cli.js`
2. Removes default `PostHogGlobal` export, and unifies import signature for `typescript`, `commonjs` and `esm` builds.

## 2.0.1 - 2022-08-15

Breaking changes:

1. Feature flag defaults are no more. When we fail to compute any flag, we return `undefined`. All computed flags return either `true`, `false` or `String`.
2. Minimum PostHog version requirement is 1.38
3. Default polling interval for feature flags is now set at 30 seconds. If you don't want local evaluation, don't set a personal API key in the library.
4. The `callback` parameter passed as an optional last argument to most of the methods is no longer supported
5. The CLI is no longer supported

What's new:

1. You can now evaluate feature flags locally (i.e. without sending a request to your PostHog servers) by setting a personal API key, and passing in groups and person properties to `isFeatureEnabled` and `getFeatureFlag` calls.
2. Introduces a `getAllFlags` method that returns all feature flags. This is useful for when you want to seed your frontend with some initial flags, given a user ID.
