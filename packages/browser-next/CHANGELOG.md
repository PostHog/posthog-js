# @posthog/browser

## 0.2.0

### Minor Changes

- [#5641](https://github.com/PostHog/posthog-js/pull/5641) [`8f7a250`](https://github.com/PostHog/posthog-js/commit/8f7a250c1c6c0c2683aaecba575e711a3d5801e0) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Move analytics operations to the analytics extension; see the [migration guide](https://github.com/PostHog/posthog-js/blob/main/packages/browser-next/README.md#migrating-to-analytics-owned-operations) for API and type replacements.
  (2026-11-13)

- [#5655](https://github.com/PostHog/posthog-js/pull/5655) [`110e377`](https://github.com/PostHog/posthog-js/commit/110e377768777526dee52eb7ff6a28f79c3fd735) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Add `alias`, `groupIdentify`, and `resetGroups` analytics helpers, including group-only cleanup of membership and feature-flag context.
  (2026-11-13)

- [#5651](https://github.com/PostHog/posthog-js/pull/5651) [`fbab154`](https://github.com/PostHog/posthog-js/commit/fbab154231f10158c8e5afac7c31fb9fd518d0f0) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Add configurable person processing, defaulting to `identified_only`, and helpers for creating profiles, setting and unsetting person properties, and marking internal or test users.
  (2026-11-13)

- [#5651](https://github.com/PostHog/posthog-js/pull/5651) [`fbab154`](https://github.com/PostHog/posthog-js/commit/fbab154231f10158c8e5afac7c31fb9fd518d0f0) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Separate person-property changes from identification notifications and fix person-update deduplication.
  (2026-11-13)

- [#5650](https://github.com/PostHog/posthog-js/pull/5650) [`7552cce`](https://github.com/PostHog/posthog-js/commit/7552cce04d02d1b207a62d178ed2d05ed721d558) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Acquire browser products on demand and require explicit products for manual Core composition.
  (2026-11-13)

### Patch Changes

- [#5640](https://github.com/PostHog/posthog-js/pull/5640) [`ec79e8a`](https://github.com/PostHog/posthog-js/commit/ec79e8a47db0bff6de7f3fbcb3ef7bcd24991097) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Allow shared extensions to declare their host type while retaining the default client contract.
  (2026-11-13)
- Updated dependencies [[`ec79e8a`](https://github.com/PostHog/posthog-js/commit/ec79e8a47db0bff6de7f3fbcb3ef7bcd24991097)]:
  - @posthog/browser-common@0.11.0

## 0.1.1

### Patch Changes

- [#5488](https://github.com/PostHog/posthog-js/pull/5488) [`358a77e`](https://github.com/PostHog/posthog-js/commit/358a77e55f9a5597d2ec36e2fc61442d580110e6) Thanks [@gustavohstrassburger](https://github.com/gustavohstrassburger)! - A `$feature_flag_called` event that the client rate limit drops is now sent again at the next capture. Before, the flag was marked as reported and its exposure was lost.
  (2026-11-04)
- Updated dependencies [[`358a77e`](https://github.com/PostHog/posthog-js/commit/358a77e55f9a5597d2ec36e2fc61442d580110e6)]:
  - @posthog/browser-common@0.10.6

## 0.1.0

### Minor Changes

- [#5397](https://github.com/PostHog/posthog-js/pull/5397) [`5a21286`](https://github.com/PostHog/posthog-js/commit/5a21286ec19a6c2ee37fe8ed2e585a2f2b8b3f5e) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Publish the experimental browser SDK as `@posthog/browser`.
  (2026-10-28)

## 0.0.4

### Patch Changes

- Updated dependencies [[`950d034`](https://github.com/PostHog/posthog-js/commit/950d03423605d1567c90a3f27f50d4603a89ae45)]:
  - @posthog/browser-common@0.10.0
  - @posthog/types@1.418.0

## 0.0.3

### Patch Changes

- Updated dependencies [[`2828b6b`](https://github.com/PostHog/posthog-js/commit/2828b6bdbd33faddf77226c3e04c296823833315)]:
  - @posthog/browser-common@0.9.0

## 0.0.2

### Patch Changes

- Updated dependencies [[`3a5b322`](https://github.com/PostHog/posthog-js/commit/3a5b32229a135af56d43a17350a222784d94c88d)]:
  - @posthog/browser-common@0.8.0

## 0.0.1

### Patch Changes

- Updated dependencies [[`a895e7e`](https://github.com/PostHog/posthog-js/commit/a895e7ecf78e434e43958052096ac03aa4670e9d)]:
  - @posthog/browser-common@0.7.0
