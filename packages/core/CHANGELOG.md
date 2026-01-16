# @posthog/core

## 1.10.0

### Minor Changes

- [#2881](https://github.com/PostHog/posthog-js/pull/2881) [`d37e570`](https://github.com/PostHog/posthog-js/commit/d37e5709863e869825df57d0854588140c4294b2) Thanks [@adboio](https://github.com/adboio)! - add support for thumbs up/down survey rating scale
  (2026-01-16)

## 1.9.1

### Patch Changes

- [#2593](https://github.com/PostHog/posthog-js/pull/2593) [`fba9fb2`](https://github.com/PostHog/posthog-js/commit/fba9fb2ea4be2ea396730741b4718b4a2c80d026) Thanks [@daibhin](https://github.com/daibhin)! - track LLMA trace_id on exceptions and exception_id on traces
  (2026-01-08)

- [#2856](https://github.com/PostHog/posthog-js/pull/2856) [`c1ed63b`](https://github.com/PostHog/posthog-js/commit/c1ed63b0f03380a5e4bb2463491b3f767f64a514) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: expose default stack parser creator
  (2026-01-08)

## 1.9.0

### Minor Changes

- [#2787](https://github.com/PostHog/posthog-js/pull/2787) [`b676b4d`](https://github.com/PostHog/posthog-js/commit/b676b4d7342c8c3b64960aa55630b2810366014e) Thanks [@lucasheriques](https://github.com/lucasheriques)! - feat: allow customizing text colors on web and react native
  (2025-12-22)

## 1.8.1

### Patch Changes

- [#2769](https://github.com/PostHog/posthog-js/pull/2769) [`6b0aabf`](https://github.com/PostHog/posthog-js/commit/6b0aabff893e44d1710b7d122a68bf023f4e0bd5) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: move the user-agent-utils from the browser to the core package
  (2025-12-17)

## 1.8.0

### Minor Changes

- [#2774](https://github.com/PostHog/posthog-js/pull/2774) [`2603a8d`](https://github.com/PostHog/posthog-js/commit/2603a8d6e1021cd8f84e8b61be77ce268435ebde) Thanks [@adboio](https://github.com/adboio)! - fix survey text color on react native
  (2025-12-16)

## 1.7.1

### Patch Changes

- [#2690](https://github.com/PostHog/posthog-js/pull/2690) [`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4) Thanks [@robbie-c](https://github.com/robbie-c)! - Related to https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182

  We didn't include any of the vulnerable deps in any of our packages, however we did have them as dev / test / example project dependencies.

  There was no way that any of these vulnerable packages were included in any of our published packages.

  We've now patched out those dependencies.

  Out of an abundance of caution, let's create a new release of all of our packages. (2025-12-04)

## 1.7.0

### Minor Changes

- [#2603](https://github.com/PostHog/posthog-js/pull/2603) [`e1617d9`](https://github.com/PostHog/posthog-js/commit/e1617d91255b23dc39b1dcb15b05ae64c735d9d0) Thanks [@dmarticus](https://github.com/dmarticus)! - add $feature_flag_evaluated_at properties to $feature_flag_called events
  (2025-12-03)

## 1.6.0

### Minor Changes

- [#2619](https://github.com/PostHog/posthog-js/pull/2619) [`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86) Thanks [@hpouillot](https://github.com/hpouillot)! - package deprecation
  (2025-11-24)

## 1.5.6

### Patch Changes

- [#2618](https://github.com/PostHog/posthog-js/pull/2618) [`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe) Thanks [@marandaneto](https://github.com/marandaneto)! - last version was compromised
  (2025-11-24)

## 1.5.5

### Patch Changes

- [#2589](https://github.com/PostHog/posthog-js/pull/2589) [`83f5d07`](https://github.com/PostHog/posthog-js/commit/83f5d07e4ae8c2ae5c6926858b6095ebbfaf319f) Thanks [@hpouillot](https://github.com/hpouillot)! - export logger creation
  (2025-11-20)

## 1.5.4

### Patch Changes

- [#2587](https://github.com/PostHog/posthog-js/pull/2587) [`c242702`](https://github.com/PostHog/posthog-js/commit/c2427029d75cba71b78e9822f18f5e73f7442288) Thanks [@hpouillot](https://github.com/hpouillot)! - export log level type
  (2025-11-20)

## 1.5.3

### Patch Changes

- [#2575](https://github.com/PostHog/posthog-js/pull/2575) [`8acd88f`](https://github.com/PostHog/posthog-js/commit/8acd88f1b71d2c7e1222c43dd121abce78ef2bab) Thanks [@hpouillot](https://github.com/hpouillot)! - fix frame platform property for $exception events
  (2025-11-19)

## 1.5.2

### Patch Changes

- [#2552](https://github.com/PostHog/posthog-js/pull/2552) [`87f9604`](https://github.com/PostHog/posthog-js/commit/87f96047739e67b847fe22137b97fc57f405b8d9) Thanks [@hpouillot](https://github.com/hpouillot)! - expose binary path resolution

## 1.5.1

### Patch Changes

- [#2540](https://github.com/PostHog/posthog-js/pull/2540) [`d8d98c9`](https://github.com/PostHog/posthog-js/commit/d8d98c95f24b612110dbf52d228c0c3bd248cd58) Thanks [@hpouillot](https://github.com/hpouillot)! - escape cli args and path in shell mode

## 1.5.0

### Minor Changes

- [#2520](https://github.com/PostHog/posthog-js/pull/2520) [`068d55e`](https://github.com/PostHog/posthog-js/commit/068d55ed4193e82729cd34b42d9e433f85b6e606) Thanks [@lricoy](https://github.com/lricoy)! - Add bot pageview collection behind preview flag. Enables tracking bot traffic as `$bot_pageview` events when the `__preview_capture_bot_pageviews` flag is enabled.

## 1.4.0

### Minor Changes

- [#2502](https://github.com/PostHog/posthog-js/pull/2502) [`751b440`](https://github.com/PostHog/posthog-js/commit/751b44040c4c0c55a19df2ad0e5f215943620e51) Thanks [@pauldambra](https://github.com/pauldambra)! - fix: bucketed rate limiter can calculate tokens without a timer

## 1.3.1

### Patch Changes

- [#2478](https://github.com/PostHog/posthog-js/pull/2478) [`e0a6fe0`](https://github.com/PostHog/posthog-js/commit/e0a6fe013b5a1e92a6e7685f35f715199b716b34) Thanks [@hpouillot](https://github.com/hpouillot)! - remove some export from main core

## 1.3.0

### Minor Changes

- [#2417](https://github.com/PostHog/posthog-js/pull/2417) [`daf919b`](https://github.com/PostHog/posthog-js/commit/daf919be225527ee4ad026d806dec195b75e44aa) Thanks [@dmarticus](https://github.com/dmarticus)! - feat: Add evaluation environments support for feature flags

  This PR adds base support for evaluation environments in the core library, allowing SDKs that extend the core to specify which environment tags their SDK instance should use when evaluating feature flags.

  The core library now handles sending the `evaluation_environments` parameter to the feature flags API when configured.

### Patch Changes

- [#2431](https://github.com/PostHog/posthog-js/pull/2431) [`7d45a7a`](https://github.com/PostHog/posthog-js/commit/7d45a7a52c44ba768913d66a4c4363d107042682) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: remove deprecated attribute $exception_personURL from exception events

## 1.2.4

### Patch Changes

- [#2419](https://github.com/PostHog/posthog-js/pull/2419) [`10da2ee`](https://github.com/PostHog/posthog-js/commit/10da2ee0b8862ad0e32b68e452fae1bc77620bbf) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - move binary calling logic to core package

## 1.2.3

### Patch Changes

- [#2414](https://github.com/PostHog/posthog-js/pull/2414) [`e19a384`](https://github.com/PostHog/posthog-js/commit/e19a384468d722c12f4ef21feb684da31f9dcd3b) Thanks [@hpouillot](https://github.com/hpouillot)! - create a common logger for node and react-native

## 1.2.2

### Patch Changes

- [#2370](https://github.com/PostHog/posthog-js/pull/2370) [`5820942`](https://github.com/PostHog/posthog-js/commit/582094255fa87009b02a4e193c3e63ef4621d9d0) Thanks [@hpouillot](https://github.com/hpouillot)! - remove testing export

## 1.2.1

### Patch Changes

- [#2356](https://github.com/PostHog/posthog-js/pull/2356) [`caecb94`](https://github.com/PostHog/posthog-js/commit/caecb94493f6b85003ecbd6750a81e27139b1fa5) Thanks [@hpouillot](https://github.com/hpouillot)! - update error properties builder

## 1.2.0

### Minor Changes

- [#2348](https://github.com/PostHog/posthog-js/pull/2348) [`ac48d8f`](https://github.com/PostHog/posthog-js/commit/ac48d8fda3a4543f300ced705bce314a206cce6f) Thanks [@hpouillot](https://github.com/hpouillot)! - chore: align js syntax with package support

## 1.1.0

### Minor Changes

- [#2330](https://github.com/PostHog/posthog-js/pull/2330) [`da07e41`](https://github.com/PostHog/posthog-js/commit/da07e41ac2307803c302557a12b459491657a75f) Thanks [@hpouillot](https://github.com/hpouillot)! - add error tracking processing

## 1.0.2

### Patch Changes

- [#2243](https://github.com/PostHog/posthog-js/pull/2243) [`1981815`](https://github.com/PostHog/posthog-js/commit/19818159b7074098150bc79cfa2962761a14cb46) Thanks [@hpouillot](https://github.com/hpouillot)! - add promise queue

## 1.0.1

### Patch Changes

- [#2219](https://github.com/PostHog/posthog-js/pull/2219) [`44d10c4`](https://github.com/PostHog/posthog-js/commit/44d10c46c5378fa046320b7c50bd046eb1e75994) Thanks [@daibhin](https://github.com/daibhin)! - provide utils methods
