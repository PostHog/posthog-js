# @posthog/core

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
